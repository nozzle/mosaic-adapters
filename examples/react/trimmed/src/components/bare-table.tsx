import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import type { Column, ColumnDef, RowData, Table } from '@tanstack/react-table';

export function BareTable<TData extends RowData, TValue>(props: {
  table: Table<TData>;
  columns: Array<ColumnDef<TData, TValue>>;
}) {
  const { table } = props;

  return (
    <div className="grid gap-4 overflow-scroll">
      <div>
        <ColumnVisibilityControls table={table} />
      </div>
      <table className="table-auto w-full">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="py-1">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-2 py-0.5">
                  {header.isPlaceholder ? null : (
                    <div className="h-full grid gap-1 items-start justify-start m-0">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {header.column.getCanFilter() ? (
                        <div>
                          <Filter column={header.column} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="py-1">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="text-nowrap px-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {table.getFooterGroups().map((footerGroup) => (
            <tr key={footerGroup.id} className="py-1">
              {footerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.footer,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
      <PaginationControls table={table} />
    </div>
  );
}

function PaginationControls<TData extends RowData>({
  table,
}: {
  table: Table<TData>;
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
    >
      <button
        onClick={() => table.firstPage()}
        disabled={!table.getCanPreviousPage()}
        style={{
          border: '1px solid grey',
          borderRadius: '0.25rem',
          padding: '0.25rem',
        }}
      >
        {'<<'}
      </button>
      <button
        onClick={() => table.previousPage()}
        disabled={!table.getCanPreviousPage()}
        style={{
          border: '1px solid grey',
          borderRadius: '0.25rem',
          padding: '0.25rem',
        }}
      >
        {'<'}
      </button>
      <button
        onClick={() => table.nextPage()}
        disabled={!table.getCanNextPage()}
        style={{
          border: '1px solid grey',
          borderRadius: '0.25rem',
          padding: '0.25rem',
        }}
      >
        {'>'}
      </button>
      <button
        onClick={() => table.lastPage()}
        disabled={!table.getCanNextPage()}
        style={{
          border: '1px solid grey',
          borderRadius: '0.25rem',
          padding: '0.25rem',
        }}
      >
        {'>>'}
      </button>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        <div>Page</div>
        <strong>
          {table.getState().pagination.pageIndex + 1} of{' '}
          {table.getPageCount().toLocaleString()}
        </strong>
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        | Go to page:
        <input
          type="number"
          min="1"
          max={table.getPageCount()}
          defaultValue={table.getState().pagination.pageIndex + 1}
          onChange={(e) => {
            const page = e.target.value ? Number(e.target.value) - 1 : 0;
            table.setPageIndex(page);
          }}
          style={{
            border: '1px solid grey',
            borderRadius: '0.25rem',
            padding: '0.25rem',
            width: '4rem',
          }}
        />
      </span>
      <select
        value={table.getState().pagination.pageSize}
        onChange={(e) => {
          table.setPageSize(Number(e.target.value));
        }}
        style={{
          border: '1px solid grey',
          borderRadius: '0.25rem',
          padding: '0.25rem',
        }}
      >
        {[5, 10, 20, 50, 100].map((pageSize) => (
          <option key={pageSize} value={pageSize}>
            Show {pageSize}
          </option>
        ))}
      </select>
    </div>
  );
}

function ColumnVisibilityControls<TData extends RowData>({
  table,
}: {
  table: Table<TData>;
}) {
  return (
    <div className="flex space-x-2">
      {table
        .getAllColumns()
        .filter((d) => d.getCanHide())
        .map((column) => (
          <div key={column.id} className="flex gap-1">
            <input
              id={column.id}
              type="checkbox"
              checked={column.getIsVisible()}
              onChange={column.getToggleVisibilityHandler()}
            />
            <label htmlFor={column.id}>{column.id}</label>
          </div>
        ))}
    </div>
  );
}

function Filter({ column }: { column: Column<any, unknown> }) {
  const columnFilterValue = column.getFilterValue();

  const { filterVariant } = column.columnDef.meta ?? {};

  const sortedUniqueValues = React.useMemo(
    () =>
      filterVariant === 'range'
        ? []
        : Array.from(column.getFacetedUniqueValues().keys())
            .sort()
            .slice(0, 5000),
    [column.getFacetedUniqueValues(), filterVariant],
  );

  return filterVariant === 'range' ? (
    <div>
      <div className="flex space-x-2">
        <DebouncedInput
          type="number"
          min={Number(column.getFacetedMinMaxValues()?.[0] ?? '')}
          max={Number(column.getFacetedMinMaxValues()?.[1] ?? '')}
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          value={(columnFilterValue as [number, number])?.[0] ?? ''}
          onChange={(value) =>
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            column.setFilterValue((old: [number, number]) => [value, old?.[1]])
          }
          placeholder={`Min ${
            column.getFacetedMinMaxValues()?.[0] !== undefined
              ? `(${column.getFacetedMinMaxValues()?.[0]})`
              : ''
          }`}
          className="w-24 border shadow rounded placeholder:text-sm text-sm"
        />
        <DebouncedInput
          type="number"
          min={Number(column.getFacetedMinMaxValues()?.[0] ?? '')}
          max={Number(column.getFacetedMinMaxValues()?.[1] ?? '')}
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          value={(columnFilterValue as [number, number])?.[1] ?? ''}
          onChange={(value) =>
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            column.setFilterValue((old: [number, number]) => [old?.[0], value])
          }
          placeholder={`Max ${
            column.getFacetedMinMaxValues()?.[1]
              ? `(${column.getFacetedMinMaxValues()?.[1]})`
              : ''
          }`}
          className="w-24 border shadow rounded placeholder:text-sm"
        />
      </div>
      <div className="h-1" />
    </div>
  ) : filterVariant === 'select' ? (
    <select
      onChange={(e) => column.setFilterValue(e.target.value)}
      value={columnFilterValue?.toString()}
      className="w-36 border shadow rounded placeholder:text-sm text-sm m-0"
    >
      <option value="" className="text-sm placeholder:text-sm">
        All
      </option>
      {sortedUniqueValues.map((value) => (
        <option
          value={value}
          key={value}
          className="text-sm placeholder:text-sm"
        >
          {value}
        </option>
      ))}
    </select>
  ) : (
    <>
      {/* Autocomplete suggestions from faceted values feature */}
      <datalist id={column.id + 'list'}>
        {sortedUniqueValues.map((value: any) => (
          <option value={value} key={value} />
        ))}
      </datalist>
      <DebouncedInput
        type="text"
        value={(columnFilterValue ?? '') as string}
        onChange={(value) => column.setFilterValue(value)}
        placeholder={`Search... (${column.getFacetedUniqueValues().size})`}
        className="w-36 border shadow rounded placeholder:text-sm text-sm"
        list={column.id + 'list'}
      />
      <div className="h-1" />
    </>
  );
}

// A typical debounced input react component
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
  }, [value]);

  return (
    <input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
