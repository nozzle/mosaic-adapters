import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import { DropdownMenuTrigger } from '@radix-ui/react-dropdown-menu';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpDown,
  EyeOff,
  Settings2Icon,
} from 'lucide-react';
import type {
  Column,
  ColumnDef,
  Row,
  RowData,
  Table as TanStackTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  cn,
  isRowHighlighted,
  toDateInputString,
  toDateTimeInputString,
} from '@/lib/utils';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

/**
 * A Shadcn UI implementation of the TanStack table.
 * Supports sorting, filtering, pagination, column visibility, row click, and row hover interactions.
 */
export function ShadcnTable<TData extends RowData, TValue>(props: {
  table: TanStackTable<TData>;
  columns: Array<ColumnDef<TData, TValue>>;
  onRowClick?: (row: Row<TData>) => void;
  onRowHover?: (row: Row<TData> | null) => void;
}) {
  const { table, columns, onRowClick, onRowHover } = props;

  return (
    <div className="grid gap-2">
      <div>
        <div className="flex items-center justify-between">
          <div className="flex flex-1 items-center gap-2" />
          <div className="flex items-center gap-2">
            <DataTableViewOptions table={table} />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      <div className="grid gap-1 items-start h-full">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {header.column.getCanFilter() ? (
                          <DataTableFilter
                            column={header.column}
                            table={table}
                          />
                        ) : null}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const isDimmed = !isRowHighlighted(row);

                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    onClick={() => onRowClick?.(row)}
                    onMouseEnter={() => onRowHover?.(row)}
                    onMouseLeave={() => onRowHover?.(null)}
                    className={cn(
                      // Interactive cursor if clickable
                      onRowClick && 'cursor-pointer transition-opacity',
                      // Dim if not highlighted
                      isDimmed && 'opacity-30 grayscale',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}

function DataTablePagination<TData>({
  table,
}: {
  table: TanStackTable<TData>;
}) {
  return (
    <div className="flex items-center justify-between px-2">
      <div className="text-muted-foreground flex-1 text-sm">
        {/* {table.getFilteredSelectedRowModel().rows.length} of{' '} */}
        {/* {table.getFilteredRowModel().rows.length} row(s) selected. */}
      </div>
      <div className="flex items-center space-x-6 lg:space-x-8">
        <div className="flex items-center space-x-2">
          <p className="text-sm">Rows per page</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-min">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[5, 10, 20, 50, 100].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-[100px] items-center justify-center text-sm text-nowrap">
          <p>
            Page{' '}
            <span className="font-medium">
              {table.getState().pagination.pageIndex + 1}
            </span>{' '}
            of <span className="font-medium">{table.getPageCount()}</span>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <p className="text-sm text-nowrap">Go to page</p>
          <div>
            <Input
              type="number"
              min="1"
              key={`page-${table.getState().pagination.pageIndex}`}
              max={table.getPageCount()}
              defaultValue={table.getState().pagination.pageIndex + 1}
              onChange={(e) => {
                const page = e.target.value ? Number(e.target.value) - 1 : 0;
                table.setPageIndex(page);
              }}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DataTableViewOptions<TData>({
  table,
}: {
  table: TanStackTable<TData>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto hidden h-8 lg:flex"
        >
          <Settings2Icon />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[150px]">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => {
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                className="capitalize"
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DataTableColumnHeaderProps<
  TData,
  TValue,
> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className, 'h-8 py-1.5 px-2')}>{title}</div>;
  }

  const sorting = column.getIsSorted();
  const multiSort = column.getCanMultiSort();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="data-[state=open]:bg-accent -ml-3 h-8"
          >
            <span>{title}</span>
            {column.getIsSorted() === 'desc' ? (
              <ArrowDown />
            ) : column.getIsSorted() === 'asc' ? (
              <ArrowUp />
            ) : (
              <ChevronsUpDown />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => {
              sorting === 'asc'
                ? column.clearSorting()
                : column.toggleSorting(false, multiSort);
            }}
            className={cn(sorting === 'asc' ? 'text-foreground' : '')}
          >
            <ArrowUp
              className={cn(sorting === 'asc' ? 'text-foreground' : '')}
            />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              sorting === 'desc'
                ? column.clearSorting()
                : column.toggleSorting(true, multiSort);
            }}
            className={cn(sorting === 'desc' ? 'text-foreground' : '')}
          >
            <ArrowDown
              className={cn(sorting === 'desc' ? 'text-foreground' : '')}
            />
            Desc
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
            <EyeOff />
            Hide
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DataTableFilter<TData extends RowData, TValue>({
  column,
  table,
}: {
  column: Column<TData, TValue>;
  table: TanStackTable<TData>;
}) {
  const { filterVariant = 'text', rangeFilterType } =
    column.columnDef.meta || {};

  return (
    <div className="pb-2 w-full">
      {filterVariant === 'range' ? (
        <DebouncedRangeFilter
          column={column}
          table={table}
          type={rangeFilterType}
        />
      ) : filterVariant === 'select' ? (
        <SelectFilter column={column} table={table} />
      ) : (
        <DebouncedTextFilter column={column} />
      )}
    </div>
  );
}

function DebouncedRangeFilter<TData extends RowData, TValue>({
  column,
  table,
  type = 'number',
  placeholderPrefix = '',
}: {
  column: Column<TData, TValue>;
  table: TanStackTable<TData>;
  type?: 'number' | 'date' | 'datetime';
  placeholderPrefix?: string;
}) {
  const columnFilterValue = column.getFilterValue();
  const minMax = column.getFacetedMinMaxValues();

  // Trigger lazy loading of min/max values on interaction
  const handleFocus = () => {
    if (!minMax) {
      // Updated to use the first-class Mosaic API on the table instance
      table.mosaic.requestFacet(column.id, 'minmax');
    }
  };

  // Determine the HTML Input type and Step
  let inputType = 'number';
  let step: string | undefined = undefined;

  if (type === 'date') {
    inputType = 'date';
  }
  if (type === 'datetime') {
    inputType = 'datetime-local';
    // Enable seconds selection in the browser picker
    step = '1';
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
    <div className="flex gap-1">
      <DebouncedInput
        type={inputType}
        step={step}
        value={currentMin}
        onFocus={handleFocus}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [value, old?.[1]])
        }
        placeholder={minValue ? `min ${minValue}` : 'min'}
        // className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-10"
        className="text-xs placeholder:text-xs py-1 px-2 min-w-24"
        onClick={(e) => e.stopPropagation()}
      />
      <DebouncedInput
        type={inputType}
        step={step}
        value={currentMax}
        onFocus={handleFocus}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [old?.[0], value])
        }
        placeholder={maxValue ? `max ${maxValue}` : 'max'}
        className="text-xs placeholder:text-xs py-1 px-2 min-w-24"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
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
      className="px-2 py-1 text-xs placeholder:text-xs"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function SelectFilter<TData extends RowData, TValue>({
  column,
  table,
}: {
  column: Column<TData, TValue>;
  table: TanStackTable<TData>;
}) {
  const colId = column.id;
  const columnFilterValue = column.getFilterValue();
  const uniqueValues = column.getFacetedUniqueValues();

  const value =
    typeof columnFilterValue === 'string' ||
    typeof columnFilterValue === 'number'
      ? columnFilterValue
      : '';

  const sortedUniqueValues = React.useMemo(
    () => Array.from(uniqueValues.keys()).sort(),
    [uniqueValues],
  );

  return (
    <NativeSelect
      value={value}
      onChange={(e) => column.setFilterValue(e.target.value)}
      // Lazy load facet data on interaction (focus/click)
      onFocus={() => table.mosaic.requestFacet(colId, 'unique')}
      className="px-2 py-1 text-xs w-full"
    >
      <NativeSelectOption value="">All</NativeSelectOption>
      {sortedUniqueValues.map((value) => (
        <NativeSelectOption value={value} key={colId + value}>
          {value}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

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
  const isMounted = React.useRef(false);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  React.useEffect(() => {
    // Skip the first run (on mount) to prevent pushing initial (often empty/undefined) values
    // to the parent immediately, which can trigger unwanted filter resets or updates.
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce]); // Re-added debounce to dependencies for correctness

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
