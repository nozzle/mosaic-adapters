import { useEffect, useState } from 'react';
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { Query } from '@uwdata/mosaic-sql';
import { useMosaicRows, useMosaicSparkline } from '@nozzleio/react-mosaic';
import {
  paginationToWindow,
  sortingToOrderBy,
  useTanStackTableFilterBridge,
} from '@nozzleio/mosaic-tanstack-react-table';
import { $page, $picked, filterSet, tableName } from '../page-context';
import { Sparkline } from './sparkline';
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import type { FilterBridgeColumns } from '@nozzleio/mosaic-tanstack-react-table';
import type { SparklinePoint } from '@nozzleio/react-mosaic';
import type { AthleteRow } from '../page-context';

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  tableMeta: {} as { sparklines: Map<unknown, Array<SparklinePoint>> },
});

const SPARKLINE_STEP = 5;

const columns: Array<ColumnDef<typeof features, AthleteRow>> = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'nationality', header: 'Country' },
  { accessorKey: 'sport', header: 'Sport' },
  { accessorKey: 'sex', header: 'Gender' },
  {
    accessorKey: 'height',
    header: 'Height',
    cell: (cell) => formatUnit(cell.getValue<number | null>(), 'm'),
  },
  {
    accessorKey: 'weight',
    header: 'Weight',
    cell: (cell) => formatUnit(cell.getValue<number | null>(), 'kg'),
  },
  { accessorKey: 'gold', header: 'Gold' },
  {
    // One batched sparkline client serves every cell in this column; its
    // series reach the cells through TanStack Table's own `table.options.meta`.
    id: 'weightDist',
    header: 'Weight dist. (sport)',
    cell: (cell) => (
      <Sparkline
        points={
          cell.table.options.meta?.sparklines.get(cell.row.original.sport) ?? []
        }
        tooltip={(point) =>
          `${point.x}–${Number(point.x) + SPARKLINE_STEP}kg: ${point.y} athletes`
        }
      />
    ),
  },
];

// Bridge config: TanStack Table column id → clause kind. Every id here must match a
// column above exactly — the bridge silently ignores unconfigured ids, so a
// typo would no-op with no signal. (The sport filter lives outside the table
// now — the facet client publishes it directly into $page.)
const bridgeColumns: FilterBridgeColumns = {
  name: { clause: 'ilike' },
  weight: { clause: 'range' },
};

/**
 * The user owns `useReactTable`, in fully manual mode: `getCoreRowModel` is
 * the only row model, and `data` / `rowCount` come verbatim from the rows
 * client. Sorting and pagination travel as serializable inputs (ORDER BY /
 * LIMIT / OFFSET execute in SQL); column filters become clauses on $page via
 * the filter bridge; row clicks publish the picked athletes into $picked.
 */
export function AthletesTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [picked, setPicked] = useState<ReadonlyMap<number, AthleteRow>>(
    new Map(),
  );

  useTanStackTableFilterBridge({
    filters: columnFilters,
    set: filterSet,
    columns: bridgeColumns,
  });

  const athletes = useMosaicRows<AthleteRow>({
    query: ({ where }) =>
      Query.from(tableName)
        .select(
          'id',
          'name',
          'nationality',
          'sport',
          'sex',
          'height',
          'weight',
          'gold',
        )
        .where(where),
    filterBy: $page,
    inputs: {
      orderBy: sortingToOrderBy(sorting), // serializable intent in…
      ...paginationToWindow(pagination), // { limit, offset }
    },
    rowCount: 'window', // COUNT(*) OVER () → totalRows
    publish: { select: { as: $picked, columns: ['id'] } },
  });

  // One batched query serves every sparkline cell on the page: per-sport
  // weight distributions, cross-filtered by $page like everything else.
  // `keys` derives from the rows client's visible page — dependent clients
  // compose through serializable inputs (value-diffed: re-rendering with the
  // same sports never re-queries; a page with new sports queries once).
  const sparklines = useMosaicSparkline({
    from: tableName,
    key: 'sport',
    x: { column: 'weight', step: SPARKLINE_STEP },
    y: { agg: 'count' },
    filterBy: $page,
    inputs: { keys: [...new Set(athletes.rows.map((row) => row.sport))] },
  });

  // A non-TanStack Table $page change (vgplot brush, facet, histogram) can shrink
  // totalRows below the current offset with no state handler involved; clamp
  // back to the last populated page so the table never strands on an empty
  // one.
  useEffect(() => {
    if (athletes.totalRows === undefined) {
      return;
    }
    const pageCount = Math.ceil(athletes.totalRows / pagination.pageSize);
    if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: Math.max(0, pageCount - 1),
      }));
    }
  }, [athletes.totalRows, pagination.pageIndex, pagination.pageSize]);

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    setColumnFilters(updater);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const table = useTable({
    features,
    data: athletes.rows, // …data out, verbatim
    rowCount: athletes.totalRows,
    columns,
    meta: { sparklines: sparklines.series }, // client output → cells
    state: { sorting, pagination, columnFilters },
    onSortingChange,
    onPaginationChange: setPagination,
    onColumnFiltersChange,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    getRowId: (row) => String(row.id),
  });

  const togglePicked = (row: AthleteRow) => {
    const next = new Map(picked);
    if (next.has(row.id)) {
      next.delete(row.id);
    } else {
      next.set(row.id, row);
    }
    setPicked(next);
    // clausePoints on the athletes' ids into $picked ([] clears the clause).
    athletes.client.selectRows([...next.values()]);
  };

  return (
    <section className="space-y-2">
      <PickedStrip
        picked={picked}
        onClear={() => {
          setPicked(new Map());
          athletes.client.selectRows([]);
        }}
      />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="athletes-table">
          <thead className="bg-slate-50 text-left">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      className="flex items-center gap-1"
                      data-testid={`sort-${header.column.id}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span className="text-xs text-slate-400">
                        {{ asc: '▲', desc: '▼' }[
                          header.column.getIsSorted() as string
                        ] ?? ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
            <tr className="border-t border-slate-200">
              {table.getFlatHeaders().map((header) => (
                <th key={header.id} className="px-3 py-1.5 font-normal">
                  <ColumnFilter column={header.column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="athletes-table-body">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                  picked.has(row.original.id) ? 'bg-amber-50' : ''
                }`}
                onClick={() => togglePicked(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          data-testid="page-prev"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          data-testid="page-next"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          Next
        </button>
        <span data-testid="page-label">
          Page {pagination.pageIndex + 1} of{' '}
          {table.getPageCount() > 0 ? table.getPageCount() : '…'}
        </span>
        <span data-testid="total-rows">
          {athletes.totalRows == null
            ? 'Counting…'
            : `${athletes.totalRows.toLocaleString('en-US')} athletes match`}
        </span>
      </div>
    </section>
  );
}

function ColumnFilter(props: {
  column: Column<typeof features, AthleteRow, unknown>;
}) {
  const { column } = props;
  if (column.id === 'name') {
    const value = (column.getFilterValue() as string | undefined) ?? '';
    return (
      <input
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
        data-testid="filter-name"
        placeholder="contains…"
        value={value}
        onChange={(event) => column.setFilterValue(event.target.value)}
      />
    );
  }
  if (column.id === 'weight') {
    const range = (column.getFilterValue() as
      | [number | undefined, number | undefined]
      | undefined) ?? [undefined, undefined];
    const setBound = (index: 0 | 1, raw: string) => {
      const bound = raw === '' ? undefined : Number(raw);
      const next: [number | undefined, number | undefined] = [...range];
      next[index] = bound;
      // Both bounds open clears the clause; a single bound publishes >= / <=.
      column.setFilterValue(next);
    };
    return (
      <div className="flex gap-1">
        <input
          className="w-14 rounded border border-slate-300 px-1 py-1 text-xs"
          data-testid="filter-weight-min"
          placeholder="min"
          type="number"
          value={range[0] ?? ''}
          onChange={(event) => setBound(0, event.target.value)}
        />
        <input
          className="w-14 rounded border border-slate-300 px-1 py-1 text-xs"
          data-testid="filter-weight-max"
          placeholder="max"
          type="number"
          value={range[1] ?? ''}
          onChange={(event) => setBound(1, event.target.value)}
        />
      </div>
    );
  }
  return null;
}

function PickedStrip(props: {
  picked: ReadonlyMap<number, AthleteRow>;
  onClear: () => void;
}) {
  // The picked rows also live in $picked as a native clause, ready for
  // downstream consumers (detail panes, comparison views) to filter by.
  // This strip renders from local state; nothing on this page consumes
  // $picked yet.
  if (props.picked.size === 0) {
    return (
      <p className="text-xs text-slate-400">
        Click rows to pick athletes (publishes into the $picked Selection).
      </p>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      data-testid="picked-strip"
    >
      <span className="text-slate-500">Picked ({props.picked.size}):</span>
      {[...props.picked.values()].map((row) => (
        <span
          key={row.id}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900"
        >
          {row.name}
        </span>
      ))}
      <button
        type="button"
        className="text-slate-500 underline"
        data-testid="picked-clear"
        onClick={props.onClear}
      >
        clear
      </button>
    </div>
  );
}

function formatUnit(value: number | null, unit: string): string {
  if (value == null) {
    return '—';
  }
  return `${value}${unit}`;
}
