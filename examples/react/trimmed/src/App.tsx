import { useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { flexRender, useReactTable } from '@tanstack/react-table';
import { MosaicDataTable } from '@nozzle/mosaic-tanstack-table-core/trimmed';

function App() {
  const dataTable = useRef(
    new MosaicDataTable('my_table', { coordinator: undefined as any }),
  );

  const store = useStore(dataTable.current.store);
  const table = useReactTable(dataTable.current.getTableOptions(store));

  return (
    <>
      <h1>Trimmed example</h1>
      <div
        style={{
          border: '1px dotted grey',
          padding: '1rem',
        }}
      >
        <em>Rendering data table</em>
        <div>
          <h3>Add row</h3>
          {['sean', 'derek', 'boyd'].map((name, index) => (
            <button
              key={name + index}
              onClick={() => {
                dataTable.current.addRow(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <h3>Data table</h3>
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
      </div>
    </>
  );
}

export default App;
