import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import type { MosaicDataTableColumnDef } from '@/useMosaicReactTable';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useMosaicReactTable } from '@/useMosaicReactTable';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

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
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns = useMemo(
    () =>
      [
        {
          id: 'id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="ID" view={view} />
          ),
          accessorKey: 'id',
          enableHiding: false,
          enableSorting: false,
        },
        {
          id: 'name',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Name" view={view} />
          ),
          accessorKey: 'name',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'nationality',
          header: ({ column }) => (
            <RenderTableHeader
              column={column}
              title="Nationality"
              view={view}
            />
          ),
          accessorKey: 'nationality',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Gender',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gender" view={view} />
          ),
          accessorKey: 'sex',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'dob',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="DOB" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (value instanceof Date) {
              return simpleDateFormatter.format(value);
            }
            return value;
          },
          accessorKey: 'date_of_birth',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Height',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Height" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}m`;
            }
            return value;
          },
          accessorKey: 'height',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Weight',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Weight" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}kg`;
            }
            return value;
          },
          accessorKey: 'weight',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Sport',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Sport" view={view} />
          ),
          accessorKey: 'sport',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Gold(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gold(s)" view={view} />
          ),
          accessorKey: 'gold',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Silver(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Silver(s)" view={view} />
          ),
          accessorKey: 'silver',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Bronze(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Bronze(s)" view={view} />
          ),
          accessorKey: 'bronze',
          enableHiding: true,
          enableSorting: true,
        },
        {
          id: 'Info',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Info" view={view} />
          ),
          accessorKey: 'info',
          enableHiding: true,
        },
      ] satisfies Array<MosaicDataTableColumnDef<AthleteRowData, any>>,
    [view],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    columns,
    tableOptions: {
      enableMultiSort: true,
    },
  });

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={table.options.columns} />;
}
