import { flexRender } from '@tanstack/react-table';
import type { RowData, Table } from '@tanstack/react-table';

export function BareTable<TData extends RowData>(props: {
  table: Table<TData>;
}) {
  const { table } = props;

  return (
    <>
      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {table.getFooterGroups().map((footerGroup) => (
            <tr key={footerGroup.id}>
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
          {[5, 10, 20, 30, 40, 50].map((pageSize) => (
            <option key={pageSize} value={pageSize}>
              Show {pageSize}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
