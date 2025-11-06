import { useEffect, useRef, useState } from 'react';
import { flexRender, useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from './useMosiacReactTable';

function App() {
  return (
    <>
      <h1>Trimmed example</h1>
      <div
        style={{
          border: '1px dotted grey',
          padding: '1rem',
        }}
      >
        <AthletesMosaic />
      </div>
    </>
  );
}

export default App;

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';
const wasmConnector = vg.wasmConnector({ log: false });
vg.coordinator().databaseConnector(wasmConnector);

const $query = vg.Selection.intersect();

function AthletesMosaic() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartDivRef.current) return;

    async function setup() {
      setIsPending(true);

      // Setup the Athletes Linear Regression Plot from https://idl.uw.edu/mosaic/examples/linear-regression.html
      await vg
        .coordinator()
        .exec([
          `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
        ]);

      const plot = vg.plot(
        vg.dot(vg.from(tableName), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          r: 2,
          opacity: 0.05,
        }),
        vg.regressionY(vg.from(tableName, { filterBy: $query }), {
          x: 'weight',
          y: 'height',
          stroke: 'sex',
        }),
        vg.intervalXY({
          as: $query,
          brush: { fillOpacity: 0, stroke: 'currentColor' },
        }),
        vg.xyDomain(vg.Fixed),
        vg.colorDomain(vg.Fixed),
      );
      chartDivRef.current?.replaceChildren(plot);

      setIsPending(false);
    }

    setup();
  }, []);

  return (
    <div>
      <h2>Athletes Dashboard Placeholder</h2>
      <div>
        <h4>Chart area</h4>
        <div ref={chartDivRef} />
      </div>
      <div>
        <h4>Table area</h4>
        {isPending ? <div>Loading data...</div> : <AthletesTable />}
      </div>
    </div>
  );
}

function AthletesTable() {
  // columns: [
  //   {
  //     accessorKey: 'name',
  //     header: 'Name',
  //     render({ headerName }) {

  //     return (<div>
  //       <div>{headerName}</div>
  //       <YourCustomFilter />
  //       </div>
  //       )
  //     },
  //     renderFilter() {},
  //     cell(props) {
  //       const value = props.getValue();
  //       return <>...</>
  //     }
  //   },
  // ],
  // selections: {
  //   $query: vg.Selection.intersect(),
  // },
  // TODO: Start getting the ColumnDefs<unknown> working...
  const { tableOptions } = useMosaicReactTable({
    table: tableName,
    coordinator: vg.coordinator(),
    debugTable: false,
  });
  const table = useReactTable(tableOptions);

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
