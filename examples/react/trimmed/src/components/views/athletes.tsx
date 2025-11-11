import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import type { MosaicDataTableColumnDef } from '@/useMosaicReactTable';
import { RenderTable } from '@/components/render-table';
import { useMosaicReactTable } from '@/useMosaicReactTable';
import { simpleDateFormatter } from '@/lib/utils';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';

const $query = vg.Selection.intersect();

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

export function AthletesView() {
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
              return simpleDateFormatter.format(value);
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
