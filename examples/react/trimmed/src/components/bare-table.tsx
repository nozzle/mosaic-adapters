import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import type {
  Column,
  ColumnDef,
  Row,
  RowData,
  Table,
} from '@tanstack/react-table';
import { cn, toDateInputString, toDateTimeInputString } from '@/lib/utils';

export function BareTable<TData extends RowData, TValue>(props: {
  table: Table<TData>;
  columns: Array<ColumnDef<TData, TValue>>;
  onRowClick?: (row: Row<TData>) => void;
}) {
  const { table, onRowClick } = props;

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
          {table.getRowModel().rows.map((row) => {
            // Robust check for highlighting
            // @ts-expect-error __is_highlighted is injected dynamically
            const rawHighlight = row.original.__is_highlighted;
            const isDimmed =
              rawHighlight !== undefined && Number(rawHighlight) === 0;

            return (
              <tr
                key={row.id}
                className={cn(
                  'py-1',
                  onRowClick && 'cursor-pointer hover:bg-slate-100',
                  isDimmed && 'opacity-30 grayscale',
                )}
                onClick={() => onRowClick?.(row)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="text-nowrap px-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
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

function Filter<TData extends RowData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const { filterVariant = 'text' } = column.columnDef.meta ?? {};

  return filterVariant === 'range' ? (
    <>
      <DebouncedRangeFilter
        column={column}
        type={column.columnDef.meta?.rangeFilterType}
      />
    </>
  ) : filterVariant === 'select' ? (
    <>
      <SelectFilter column={column} />
    </>
  ) : (
    <>
      <DebouncedTextFilter column={column} />
    </>
  );
}

function DebouncedTextFilter<TData extends RowData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const columnFilterValue = column.getFilterValue();

  const inputValue =
    typeof columnFilterValue === 'string' ? columnFilterValue : '';

  return (
    <DebouncedInput
      type="text"
      value={inputValue}
      onChange={(value) => column.setFilterValue(value)}
      placeholder="Search..."
      className="mt-1 px-2 py-1 text-xs border rounded shadow-sm w-full font-normal text-gray-600 focus:border-blue-500 outline-none"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function SelectFilter<TData extends RowData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const columnFilterValue = column.getFilterValue();
  const uniqueValues = column.getFacetedUniqueValues();

  const sortedUniqueValues = React.useMemo(
    () => Array.from(uniqueValues.keys()).sort(),
    [uniqueValues],
  );

  return (
    <select
      onChange={(e) => column.setFilterValue(e.target.value)}
      value={columnFilterValue?.toString() || ''}
      className="px-2 py-1 text-xs border rounded shadow-sm w-full font-normal text-gray-600 focus:border-blue-500 outline-none bg-white mt-1"
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">All</option>
      {sortedUniqueValues.map((value: any) => (
        <option value={value} key={value}>
          {value}
        </option>
      ))}
    </select>
  );
}

function DebouncedRangeFilter({
  column,
  type = 'number',
  placeholderPrefix = '',
}: {
  column: any;
  type?: 'number' | 'date' | 'datetime';
  placeholderPrefix?: string;
}) {
  const columnFilterValue = column.getFilterValue();
  const minMax = column.getFacetedMinMaxValues();

  // Determine the HTML Input type
  let inputType = 'number';
  if (type === 'date') {
    inputType = 'date';
  }
  if (type === 'datetime') {
    inputType = 'datetime-local';
  }

  // Determine how to format the value for the input
  const formatValue = (val: unknown) => {
    if (type === 'datetime') {
      return toDateTimeInputString(val);
    }
    if (type === 'date') {
      return toDateInputString(val);
    }
    if (typeof val === 'number' || typeof val === 'string') {
      return val;
    }
    return '';
  };

  const minValue =
    minMax?.[0] !== undefined ? formatValue(minMax[0]) : placeholderPrefix;
  const maxValue =
    minMax?.[1] !== undefined ? formatValue(minMax[1]) : placeholderPrefix;

  const currentMin =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (columnFilterValue as [any, any])?.[0] !== undefined
      ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        formatValue((columnFilterValue as [any, any])?.[0])
      : '';

  const currentMax =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (columnFilterValue as [any, any])?.[1] !== undefined
      ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        formatValue((columnFilterValue as [any, any])?.[1])
      : '';

  return (
    <div className="flex gap-1 mt-1">
      <DebouncedInput
        type={inputType}
        value={currentMin}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [value, old?.[1]])
        }
        placeholder={`Min ${minValue ? `(${minValue})` : ''}`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-10"
        onClick={(e) => e.stopPropagation()}
      />
      <DebouncedInput
        type={inputType}
        value={currentMax}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [old?.[0], value])
        }
        placeholder={`Max ${maxValue ? `(${maxValue})` : ''}`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-10"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
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