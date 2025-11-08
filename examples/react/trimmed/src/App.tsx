import { useEffect, useMemo, useRef, useState } from 'react';
import { createColumnHelper, useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from './useMosiacReactTable';
import { RenderTable } from './components/render-table';

function App() {
  return (
    <main className="p-4">
      <h1 className="text-2xl mb-2 font-medium">Trimmed example</h1>
      <div className="border border-slate-500 border-dashed p-4">
        <AthletesMosaic />
      </div>
    </main>
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
    <>
      <h2 className="text-xl mb-4 font-medium">
        Athletes Dashboard Placeholder
      </h2>
      <hr className="my-4" />
      <h4 className="text-lg mb-2 font-medium">Chart area</h4>
      {isPending && <div className="italic">Loading data...</div>}
      <div ref={chartDivRef} />
      <hr className="my-4" />
      <h4 className="text-lg mb-2 font-medium">Table area</h4>
      {isPending ? (
        <div className="italic">Loading data...</div>
      ) : (
        <AthletesTable />
      )}
    </>
  );
}

type AthleteRowData = {
  id: number;
  name: string;
  nationality: string;
  sex: string;
  date_of_birth: Date | null;
  height: number | null;
  weight: number | null;
  sport: string | null;
  gold: number | null;
  silver: number | null;
  bronze: number | null;
  info: string | null;
};

const columnHelper = createColumnHelper<AthleteRowData>();

function AthletesTable() {
  const columns = useMemo(
    () => [
      columnHelper.accessor('id', { header: 'ID' }),
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('nationality', { header: 'Nationality' }),
      columnHelper.accessor('sex', { header: 'Gender' }),
      columnHelper.accessor('date_of_birth', {
        header: 'DOB',
        cell: (props) => {
          const value = props.getValue();
          if (value instanceof Date) {
            return dateFormatter.format(value);
          }
          return value;
        },
      }),
      columnHelper.accessor('height', {
        header: 'Height',
        cell: (props) => {
          const value = props.getValue();
          if (typeof value === 'number') {
            return `${value}m`;
          }
          return value;
        },
      }),
      columnHelper.accessor('weight', {
        header: 'Weight',
        cell: (props) => {
          const value = props.getValue();
          if (typeof value === 'number') {
            return `${value}kg`;
          }
          return value;
        },
      }),
      columnHelper.accessor('sport', { header: 'Sport' }),
      columnHelper.accessor('gold', { header: 'Gold(s)' }),
      columnHelper.accessor('silver', { header: 'Silver(s)' }),
      columnHelper.accessor('bronze', { header: 'Bronze(s)' }),
      columnHelper.accessor('info', { header: 'Info' }),
    ],
    [],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    coordinator: vg.coordinator(),
    debugTable: false,
    onTableStateChange: 'requestUpdate',
    filterBy: $query,
    columns,
  });

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={columns} />;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});
