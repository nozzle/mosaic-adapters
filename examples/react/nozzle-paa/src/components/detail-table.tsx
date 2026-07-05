/**
 * The detail table: user-owned `useReactTable` in fully manual mode. Column
 * filters become Selection clauses through the TanStack filter bridge
 * (including the struct-path `related_phrase.phrase` column) and land in
 * `$detail` — which the table's own context includes, so, matching the
 * legacy page, the detail table is filtered by its own filters while every
 * sibling widget sees them too.
 */
import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Query, sql } from '@uwdata/mosaic-sql';
import { useMosaicRows } from '@nozzleio/react-mosaic';
import {
  paginationToWindow,
  useTanStackFilterBridge,
} from '@nozzleio/mosaic-tanstack-react-table';
import { tableName } from '../page-context';
import { usePageContexts, usePageFilterSet } from '../topology';
import { WidgetSqlDetails } from './widget-sql-details';
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table';
import type { FilterBridgeColumns } from '@nozzleio/mosaic-tanstack-react-table';

interface DetailRow {
  domain: string | null;
  question: string | null;
  title: string | null;
  description: string | null;
}

const columns: Array<ColumnDef<DetailRow>> = [
  { accessorKey: 'domain', header: 'Domain', size: 150 },
  { accessorKey: 'question', header: 'PAA Question', size: 350 },
  { accessorKey: 'title', header: 'Answer Title', size: 300 },
  { accessorKey: 'description', header: 'Answer Description', size: 400 },
];

// Every column filters as a partial (case-insensitive contains) match; the
// question TanStack id maps onto the struct path. Spec ids are prefixed
// `detail:` (idPrefix below); labels drive the chip bar's Detail Filters group.
const bridgeColumns: FilterBridgeColumns = {
  domain: { clause: 'ilike', label: 'Domain' },
  question: {
    column: 'related_phrase.phrase',
    clause: 'ilike',
    label: 'PAA Question',
  },
  title: { clause: 'ilike', label: 'Answer Title' },
  description: { clause: 'ilike', label: 'Answer Description' },
};

const PAGE_SIZE = 20;

export function DetailTable(props: { enabled: boolean }) {
  const filterSet = usePageFilterSet();
  const { page } = usePageContexts();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  useTanStackFilterBridge({
    filters: columnFilters,
    set: filterSet,
    columns: bridgeColumns,
    idPrefix: 'detail:',
    // Chip removal and global reset win over TanStack state: the bridge reports
    // the surviving filter state after an external spec removal, so we adopt it
    // and the cleared columns' inputs empty instead of republishing.
    onExternalChange: (filters) => {
      setColumnFilters(filters);
    },
  });

  const details = useMosaicRows<DetailRow>({
    query: ({ where }) =>
      Query.from(tableName)
        .select({
          domain: 'domain',
          question: sql`"related_phrase"."phrase"`,
          title: 'title',
          description: 'description',
        })
        .where(where),
    filterBy: page,
    inputs: paginationToWindow(pagination),
    rowCount: 'window',
    enabled: props.enabled,
  });

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    setColumnFilters(updater);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const table = useReactTable({
    data: details.rows,
    rowCount: details.totalRows,
    columns,
    state: { columnFilters, pagination },
    onColumnFiltersChange,
    onPaginationChange: setPagination,
    manualFiltering: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex h-full flex-col" data-testid="detail-table">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 font-medium"
                    style={{ width: header.column.getSize() }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
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
          <tbody data-testid="detail-table-body">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 align-top">
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
      <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        <button
          type="button"
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          data-testid="detail-page-prev"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          data-testid="detail-page-next"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          Next
        </button>
        <span data-testid="detail-total-rows">
          {details.totalRows === undefined
            ? 'Counting…'
            : `${details.totalRows.toLocaleString()} rows match`}
        </span>
      </div>
      <WidgetSqlDetails store={details.client.store} />
    </div>
  );
}

function ColumnFilter(props: { column: Column<DetailRow, unknown> }) {
  const value = (props.column.getFilterValue() as string | undefined) ?? '';
  return (
    <input
      className="w-full rounded border border-slate-200 px-2 py-1 text-xs font-normal"
      data-testid={`detail-filter-${props.column.id}`}
      placeholder="contains…"
      value={value}
      onChange={(event) => props.column.setFilterValue(event.target.value)}
    />
  );
}
