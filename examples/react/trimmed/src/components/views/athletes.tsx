/**
 * View component for the Athletes dataset.
 * Updated to use the factory-created AthletesViewModel.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicReactTable,
  useMosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import { createAthletesModel } from './athletes-model';
import type { AthletesViewModel } from './athletes-model';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { ResetDashboardButton } from '@/components/reset-button';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';

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

export function AthletesView({
  onResetRequest,
}: {
  onResetRequest: () => void;
}) {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  const model = useMosaicViewModel(
    (c) => createAthletesModel(c),
    vg.coordinator(),
  );

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
        setIsPending(true);

        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
          ]);

        const inputs = vg.hconcat(
          vg.menu({
            label: 'Sport',
            as: model.selections.query,
            from: tableName,
            column: 'sport',
          }),
          vg.menu({
            label: 'Gender',
            as: model.selections.query,
            from: tableName,
            column: 'sex',
          }),
          vg.search({
            label: 'Name',
            as: model.selections.query,
            from: tableName,
            column: 'name',
            type: 'contains',
          }),
        );

        const plot = vg.plot(
          vg.dot(vg.from(tableName, { filterBy: model.selections.combined }), {
            x: 'weight',
            y: 'height',
            fill: 'sex',
            r: 2,
            opacity: 0.05,
          }),
          vg.regressionY(
            vg.from(tableName, { filterBy: model.selections.combined }),
            {
              x: 'weight',
              y: 'height',
              stroke: 'sex',
            },
          ),
          vg.intervalXY({
            as: model.selections.query,
            brush: { fillOpacity: 0, stroke: 'currentColor' },
          }),
          vg.xyDomain(vg.Fixed),
          vg.colorDomain(vg.Fixed),
        );

        const layout = vg.vconcat(inputs, vg.vspace(10), plot);
        chartDivRef.current?.replaceChildren(layout);
        setIsPending(false);
      } catch (err) {
        console.warn('AthletesView setup failed:', err);
      }
    }

    setup();
  }, [model]);

  return (
    <>
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-lg font-medium">Chart & Controls</h4>
        <ResetDashboardButton onReset={onResetRequest} />
      </div>
      {isPending && (
        <div className="italic text-slate-400">Loading data...</div>
      )}
      <div ref={chartDivRef} />
      <hr className="my-4" />
      <h4 className="text-lg mb-2 font-medium">Table area</h4>
      {isPending ? (
        <div className="italic text-slate-400">Loading table...</div>
      ) : (
        <AthletesTable model={model} />
      )}
    </>
  );
}

function AthletesTable({ model }: { model: AthletesViewModel }) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns: Array<ColumnDef<AthleteRowData, any>> = useMemo(
    () =>
      [
        {
          id: 'id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="ID" view={view} />
          ),
          accessorKey: 'id',
          enableColumnFilter: false,
        },
        {
          id: 'Name',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Name" view={view} />
          ),
          accessorKey: 'name',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'name',
              sqlFilterType: 'PARTIAL_ILIKE' as const,
            },
            filterVariant: 'text' as const,
          },
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
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'nationality',
              sqlFilterType: 'EQUALS' as const,
              facet: 'unique' as const,
            },
            filterVariant: 'select' as const,
          },
        },
        {
          id: 'Gender',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gender" view={view} />
          ),
          accessorKey: 'sex',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sex',
              sqlFilterType: 'EQUALS' as const,
              facet: 'unique' as const,
            },
            filterVariant: 'select' as const,
          },
        },
        {
          id: 'dob',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="DOB" view={view} />
          ),
          cell: (props) => {
            const val = props.getValue();
            return val instanceof Date ? simpleDateFormatter.format(val) : val;
          },
          accessorKey: 'date_of_birth',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'date_of_birth',
              sqlFilterType: 'RANGE' as const,
            },
            filterVariant: 'range' as const,
            rangeFilterType: 'date' as const,
          },
        },
        {
          id: 'Height',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Height" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            return typeof value === 'number' ? `${value}m` : value;
          },
          accessorKey: 'height',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'height',
              sqlFilterType: 'RANGE' as const,
              facet: 'minmax' as const,
            },
            filterVariant: 'range' as const,
            rangeFilterType: 'number' as const,
          },
        },
        {
          id: 'Weight',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Weight" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            return typeof value === 'number' ? `${value}kg` : value;
          },
          accessorKey: 'weight',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'weight',
              sqlFilterType: 'RANGE' as const,
              facet: 'minmax' as const,
            },
            filterVariant: 'range' as const,
            rangeFilterType: 'number' as const,
          },
        },
        {
          id: 'Sport',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Sport" view={view} />
          ),
          accessorKey: 'sport',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sport',
              sqlFilterType: 'PARTIAL_ILIKE' as const,
              facet: 'unique' as const,
            },
            filterVariant: 'select' as const,
          },
        },
        {
          id: 'Gold(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gold(s)" view={view} />
          ),
          accessorKey: 'gold',
          enableColumnFilter: false,
        },
        {
          id: 'Silver(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Silver(s)" view={view} />
          ),
          accessorKey: 'silver',
          enableColumnFilter: false,
        },
        {
          id: 'Bronze(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Bronze(s)" view={view} />
          ),
          accessorKey: 'bronze',
          enableColumnFilter: false,
        },
        {
          id: 'Info',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Info" view={view} />
          ),
          accessorKey: 'info',
          enableSorting: false,
          enableColumnFilter: false,
        },
        {
          id: 'actions',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Actions" view={view} />
          ),
          cell: ({ row }) => (
            <button
              className="px-1 py-0.5 border rounded text-xs opacity-80 hover:opacity-100"
              onClick={() => console.info('Athlete:', row.original)}
            >
              Log
            </button>
          ),
          enableHiding: false,
          enableSorting: false,
          enableColumnFilter: false,
        },
      ] satisfies Array<ColumnDef<AthleteRowData, any>>,
    [view],
  );

  const { tableOptions } = useMosaicReactTable({
    table: tableName,
    filterBy: model.selections.query,
    tableFilterSelection: model.selections.tableFilter,
    columns,
    totalRowsMode: 'window',
    tableOptions: {
      enableHiding: true,
      enableMultiSort: true,
      enableSorting: true,
      enableColumnFilters: true,
    },
  });

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={columns} />;
}
