import { useEffect, useMemo, useRef, useState } from 'react';
import { createColumnHelper, useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from './useMosiacReactTable';
import { RenderTable } from './components/render-table';

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

type RowData = {
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

const columnHelper = createColumnHelper<RowData>();

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
      columnHelper.accessor('weight', { header: 'Weight' }),
      columnHelper.accessor('sport', { header: 'Sport' }),
      columnHelper.accessor('gold', { header: 'Gold(s)' }),
      columnHelper.accessor('silver', { header: 'Silver(s)' }),
      columnHelper.accessor('bronze', { header: 'Bronze(s)' }),
      columnHelper.accessor('info', { header: 'Info' }),
    ],
    [],
  );

  const { tableOptions } = useMosaicReactTable<RowData>({
    table: tableName,
    coordinator: vg.coordinator(),
    debugTable: false,
    onTableStateChange: 'requestUpdate',
    filterBy: $query,
    columns,
  });

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} />;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});
