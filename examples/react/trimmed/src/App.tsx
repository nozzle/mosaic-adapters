import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from './useMosiacReactTable';
import { RenderTable } from './components/render-table';
import type { MosaicDataTableColumnDef } from './useMosiacReactTable';

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

function AthletesTable() {
  const columns = useMemo(
    () =>
      [
        {
          header: 'ID',
          accessorFn: (row) => row.id,
          mosaicColumn: 'id',
          enableHiding: false,
        },
        {
          header: 'Name',
          accessorFn: (row) => row.name,
          mosaicColumn: 'name',
          enableHiding: true,
        },
        {
          header: 'Nationality',
          accessorFn: (row) => row.nationality,
          mosaicColumn: 'nationality',
          enableHiding: true,
        },
        {
          id: 'Gender',
          header: 'Gender',
          accessorKey: 'sex',
          enableHiding: true,
        },
        {
          id: 'DOB',
          header: 'DOB',
          cell: (props) => {
            const value = props.getValue();
            if (value instanceof Date) {
              return dateFormatter.format(value);
            }
            return value;
          },
          // This is an example of a remapped column, where the DB field of "date_of_birth" is mapped to "person_dob"
          accessorKey: 'person_dob',
          mosaicColumn: 'date_of_birth',
          enableHiding: true,
        },
        {
          id: 'Height',
          header: 'Height',
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}m`;
            }
            return value;
          },
          accessorKey: 'height',
          mosaicColumn: 'height',
          enableHiding: true,
        },
        {
          id: 'Weight',
          header: 'Weight',
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}kg`;
            }
            return value;
          },
          accessorKey: 'weight',
          mosaicColumn: 'weight',
          enableHiding: true,
        },
        {
          id: 'Sport',
          header: 'Sport',
          accessorKey: 'sport',
          enableHiding: true,
        },
        {
          id: 'Gold(s)',
          header: 'Gold(s)',
          accessorKey: 'gold',
          enableHiding: true,
        },
        {
          id: 'Silver(s)',
          header: 'Silver(s)',
          accessorKey: 'silver',
          enableHiding: true,
        },
        {
          id: 'Bronze(s)',
          header: 'Bronze(s)',
          accessorKey: 'bronze',
          enableHiding: true,
        },
        {
          id: 'Info',
          header: 'Info',
          accessorKey: 'info',
          enableHiding: true,
        },
      ] satisfies Array<MosaicDataTableColumnDef<AthleteRowData, any>>,
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

  return <RenderTable table={table} columns={table.options.columns} />;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});
