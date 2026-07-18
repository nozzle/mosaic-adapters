/**
 * The detail table: user-owned `useTable` (TanStack Table v9) in fully manual
 * mode, driven by the spec. Columns come straight from `widget.columns`; the
 * structured `widget.query` is compiled to a `QuerySource`; column filters
 * become Selection clauses through the TanStack Table filter bridge configured
 * from `widget.bridge_columns`, keyed by an id prefix derived from the widget id.
 *
 * The table's own `filterBy` context includes the bridged clauses (they land in
 * the page `where` target), so the detail table is filtered by its own filters
 * while every sibling widget sees them too.
 */
import { useMemo, useState } from 'react';
import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  flexRender,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useMosaicRows } from '@nozzleio/react-mosaic';
import {
  paginationToWindow,
  useTanStackTableFilterBridge,
} from '@nozzleio/mosaic-tanstack-react-table';
import { compileStructuredQuery } from '../spec/query-compiler';
import { compileExclude } from '../spec/exclude';
import { resolveSelection, resolveVariable } from '../spec/topology';
import { WidgetSqlPopover } from './widget-sql-details';
import type { ReactElement } from 'react';
import type { Param } from '@uwdata/mosaic-core';
import type { ParamLike } from '@uwdata/mosaic-sql';
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table';
import type { FilterBridgeColumns } from '@nozzleio/mosaic-tanstack-react-table';
import type { RowsInputs } from '@nozzleio/react-mosaic';
import type { DataTableWidgetSpec } from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';

const features = tableFeatures({
  rowPaginationFeature,
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
});

/** Detail rows are dynamic (columns come from the spec), so keys are open. */
type DetailRow = Record<string, unknown>;

/**
 * RFC-4180 field escaping: stringify (null/undefined → empty), then wrap in
 * double quotes and double any embedded quote whenever the value contains a
 * quote, comma, or newline. Defensive against arbitrary cell contents.
 */
function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/["\n\r,]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Trigger a client-side download of `content` as `filename` (Blob + object URL). */
function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Thin narrowing wrapper. Narrow to this renderer and hand the already-narrowed
 * widget to the inner table so every hook runs unconditionally (rules-of-hooks).
 */
export function DataTableWidget({
  widget,
  context,
}: WidgetComponentProps): ReactElement | null {
  if (widget.renderer !== 'data-table') {
    return null;
  }
  return <DataTable widget={widget} context={context} />;
}

interface DataTableProps {
  widget: DataTableWidgetSpec;
  context: WidgetContext;
}

function DataTable({ widget, context }: DataTableProps): ReactElement {
  const { topology, filterSet, enabled } = context;

  const filterBy = resolveSelection(topology, widget.filter_by);
  // `exclude` (see spec/exclude.ts): `'all'` drops filterBy; a list yields a
  // stable `skipSources` set dropping just those clauses. The bridged column
  // filters this table publishes still land in the page (they are not resolved
  // through this client's own filterBy).
  const exclude = useMemo(
    () => compileExclude(widget.exclude),
    [widget.exclude],
  );
  const detailFilterBy = exclude.omitFilterBy ? undefined : filterBy;
  // A structured column may be a `$variable` ref — compiled to a `column(param)`
  // named by the variable's value. The compiler stays pure by taking a resolver
  // (topology access is the widget's), and reports back which variables it bound
  // so we hand them to the client as `params` (a variable change then re-queries).
  const compiled = useMemo(
    () =>
      compileStructuredQuery<RowsInputs>(
        widget.query,
        (name) => resolveVariable(topology, name) as ParamLike,
      ),
    [widget.query, topology],
  );
  const query = compiled.source;
  const params = useMemo(() => {
    const bound: Record<string, Param<unknown>> = {};
    for (const name of compiled.variables) {
      bound[name] = resolveVariable(topology, name) as Param<unknown>;
    }
    return bound;
  }, [compiled, topology]);

  const columns = useMemo<Array<ColumnDef<typeof features, DetailRow>>>(
    () =>
      widget.columns.map((column) => ({
        accessorKey: column.accessor_key,
        header: column.header,
        ...(column.size !== undefined ? { size: column.size } : {}),
      })),
    [widget.columns],
  );

  const bridgeColumns = widget.bridge_columns as FilterBridgeColumns;
  const idPrefix = `${widget.id}:`;

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: widget.page_size,
  });

  useTanStackTableFilterBridge({
    filters: columnFilters,
    set: filterSet,
    columns: bridgeColumns,
    idPrefix,
    // Chip removal and global reset win over TanStack Table state: adopt the
    // surviving filter state the bridge reports after an external removal.
    onExternalChange: (filters) => {
      setColumnFilters(filters);
    },
  });

  const details = useMosaicRows<DetailRow>({
    query,
    filterBy: detailFilterBy,
    ...(exclude.skipSources !== undefined
      ? { skipSources: exclude.skipSources }
      : {}),
    ...(compiled.variables.length > 0 ? { params } : {}),
    inputs: paginationToWindow(pagination),
    rowCount: 'window',
    enabled,
  });

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    setColumnFilters(updater);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const table = useTable({
    features,
    data: details.rows,
    rowCount: details.totalRows,
    columns,
    state: { columnFilters, pagination },
    onColumnFiltersChange,
    onPaginationChange: setPagination,
    manualFiltering: true,
    manualPagination: true,
  });

  // Own page-count bookkeeping (rather than `table.getPageCount()`, which
  // falls back to counting the current page's rows while `totalRows` is
  // still resolving): unknown until the count settles, so the last-page jump
  // can early-return instead of landing on a stale page derived from the
  // in-flight window.
  const pageCount =
    details.totalRows === undefined
      ? null
      : Math.max(1, Math.ceil(details.totalRows / widget.page_size));

  const goToFirstPage = (): void => {
    table.setPageIndex(0);
  };

  const goToLastPage = (): void => {
    if (pageCount === null) {
      return;
    }
    table.setPageIndex(pageCount - 1);
  };

  // Free-form widget `meta`, interpreted defensively: this renderer honors only
  // `exportable: true`; any other keys are ignored, and absent/unknown meta is a
  // no-op (never throw on meta contents). When set, an Export button downloads
  // the CURRENT page's rows as CSV with headers derived from the column defs.
  const exportable = widget.meta?.['exportable'] === true;

  const exportCsv = () => {
    const headerRow = widget.columns
      .map((column) => escapeCsvField(column.header))
      .join(',');
    const bodyRows = table.getRowModel().rows.map((row) => {
      const original = row.original;
      return widget.columns
        .map((column) => escapeCsvField(original[column.accessor_key]))
        .join(',');
    });
    downloadCsv(`${widget.id}.csv`, [headerRow, ...bodyRows].join('\n'));
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-gf border border-line bg-panel transition-colors hover:border-line-strong"
      data-testid={`detail-${widget.id}`}
    >
      <div className="relative flex h-[30px] shrink-0 items-center justify-between gap-2 border-b border-line px-3 text-xs font-medium text-ink">
        <span className="truncate">{widget.title}</span>
        <WidgetSqlPopover store={details.client.store} label={widget.title} />
      </div>
      <div className="min-h-[400px] flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-panel-header text-left">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-line">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted uppercase"
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
            <tr className="border-b border-line">
              {table.getFlatHeaders().map((header) => (
                <th key={header.id} className="px-2 py-1 font-normal">
                  <ColumnFilter column={header.column} widgetId={widget.id} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid={`detail-${widget.id}-body`}>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-line align-top hover:bg-hover"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1.5 text-muted">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          data-testid={`detail-${widget.id}-first`}
          disabled={!table.getCanPreviousPage()}
          aria-label={`First ${widget.title} page`}
          onClick={goToFirstPage}
        >
          «
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          data-testid={`detail-${widget.id}-prev`}
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          data-testid={`detail-${widget.id}-next`}
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          Next
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          data-testid={`detail-${widget.id}-last`}
          disabled={pageCount === null || pagination.pageIndex + 1 >= pageCount}
          aria-label={`Last ${widget.title} page`}
          onClick={goToLastPage}
        >
          »
        </button>
        <span data-testid={`detail-${widget.id}-page`}>
          Page {pagination.pageIndex + 1}
          {pageCount === null ? '' : ` of ${pageCount}`}
        </span>
        <span data-testid={`detail-${widget.id}-total`}>
          {details.totalRows === undefined
            ? 'Counting…'
            : `${details.totalRows.toLocaleString()} rows match`}
        </span>
        {exportable ? (
          <button
            type="button"
            className="ml-auto rounded-gf border border-line px-2 py-0.5 hover:border-line-strong"
            data-testid={`detail-${widget.id}-export`}
            onClick={exportCsv}
          >
            Export CSV
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ColumnFilter(props: {
  column: Column<typeof features, DetailRow, unknown>;
  widgetId: string;
}): ReactElement {
  const value = (props.column.getFilterValue() as string | undefined) ?? '';
  return (
    <input
      className="w-full rounded-gf border border-line bg-field px-2 py-1 text-xs font-normal text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
      data-testid={`detail-${props.widgetId}-filter-${props.column.id}`}
      placeholder="contains…"
      value={value}
      onChange={(event) => props.column.setFilterValue(event.target.value)}
    />
  );
}
