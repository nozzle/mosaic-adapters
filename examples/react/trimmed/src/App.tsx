import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { flexRender, useReactTable } from '@tanstack/react-table';
import { createMosaicDataTableClient } from '@nozzle/mosaic-tanstack-table-core/trimmed';
import * as vg from '@uwdata/vgplot';

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

const wasmConnector = vg.wasmConnector({ log: false });
vg.coordinator().databaseConnector(wasmConnector);

const $query = vg.Selection.intersect();

function AthletesMosaic() {
  const dataTable = useRef(
    createMosaicDataTableClient('athletes', vg.coordinator()),
  );
  const store = useStore(dataTable.current.store);
  const table = useReactTable(dataTable.current.getTableOptions(store));

  const chartDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartDivRef.current) return;

    async function setup() {
      // Setup the Athletes Linear Regression Plot from https://idl.uw.edu/mosaic/examples/linear-regression.html
      await vg
        .coordinator()
        .exec([
          `CREATE OR REPLACE TABLE athletes AS SELECT * FROM '${fileURL}'`,
        ]);

      const plot = vg.plot(
        vg.dot(vg.from('athletes'), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          r: 2,
          opacity: 0.05,
        }),
        vg.regressionY(vg.from('athletes', { filterBy: $query }), {
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
    </div>
  );
}
