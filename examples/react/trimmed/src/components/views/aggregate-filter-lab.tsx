import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as mSql from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { Selection } from '@uwdata/mosaic-core';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import { coerceNumber } from '@nozzleio/mosaic-tanstack-react-table/helpers';
import {
  useConnectorStatus,
  useRegisterSelections,
} from '@nozzleio/react-mosaic';
import type { ColumnDef } from '@tanstack/react-table';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';

const tableName = 'athletes_aggregate_lab';
const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';

const rowFilterSource = { id: 'aggregate-lab-row-filter' };
const aggregateFilterSource = { id: 'aggregate-lab-having-filter' };

type AggregateRow = {
  nationality: string;
  athlete_count: number;
  total_gold: number;
};

function buildHavingPredicate(minGold: number, minCount: number) {
  const clauses: Array<FilterExpr> = [];

  if (minGold > 0) {
    clauses.push(mSql.sql`SUM(gold) >= ${minGold}`);
  }

  if (minCount > 0) {
    clauses.push(mSql.sql`COUNT(*) >= ${minCount}`);
  }

  if (clauses.length === 0) {
    return null;
  }

  if (clauses.length === 1) {
    return clauses[0]!;
  }

  return mSql.and(...clauses);
}

function updateRowFilter(selection: Selection, sex: string) {
  const predicate =
    sex === 'all' ? null : mSql.eq(mSql.column('sex'), mSql.literal(sex));

  selection.update({
    source: rowFilterSource,
    value: sex === 'all' ? null : { sex },
    predicate,
  });
}

function updateAggregateFilter(
  selection: Selection,
  minGold: number,
  minCount: number,
) {
  selection.update({
    source: aggregateFilterSource,
    value: minGold > 0 || minCount > 0 ? { minGold, minCount } : null,
    predicate: buildHavingPredicate(minGold, minCount) as never,
  });
}

export function AggregateFilterLabView() {
  const [isPending, setIsPending] = useState(true);
  const [sex, setSex] = useState('all');
  const [minGold, setMinGold] = useState(0);
  const [minCount, setMinCount] = useState(0);
  const { mode } = useConnectorStatus();

  const filterBy = useMemo(() => Selection.intersect(), []);
  const havingBy = useMemo(() => Selection.intersect(), []);
  useRegisterSelections([filterBy, havingBy]);

  useEffect(() => {
    updateRowFilter(filterBy, sex);
  }, [filterBy, sex]);

  useEffect(() => {
    updateAggregateFilter(havingBy, minGold, minCount);
  }, [havingBy, minGold, minCount]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        setIsPending(true);
        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
          ]);
      } finally {
        if (!cancelled) {
          setIsPending(false);
        }
      }
    }

    void setup();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <div className="grid gap-4" data-testid="aggregate-filter-lab">
      <div>
        <h2 className="text-2xl font-bold">Aggregate Filter Lab</h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          Row filters change the source athletes before grouping. Aggregate
          thresholds filter grouped nationality results after the medal totals
          and athlete counts are computed.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="border rounded-md p-3 bg-white">
          <div className="font-semibold text-sm mb-3">WHERE row filter</div>
          <label className="grid gap-1 text-sm">
            Gender
            <select
              className="border rounded-md px-2 py-2 text-sm"
              value={sex}
              onChange={(event) => setSex(event.target.value)}
              aria-label="WHERE gender"
            >
              <option value="all">All athletes</option>
              <option value="Female">Female athletes</option>
              <option value="Male">Male athletes</option>
            </select>
          </label>
        </section>

        <section className="border rounded-md p-3 bg-white">
          <div className="font-semibold text-sm mb-3">
            HAVING aggregate thresholds
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Minimum SUM(gold)
              <input
                className="border rounded-md px-2 py-2 text-sm"
                type="number"
                min={0}
                step={1}
                value={minGold}
                onChange={(event) =>
                  setMinGold(Math.max(0, Number(event.target.value) || 0))
                }
                aria-label="Minimum SUM gold"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Minimum COUNT(*)
              <input
                className="border rounded-md px-2 py-2 text-sm"
                type="number"
                min={0}
                step={1}
                value={minCount}
                onChange={(event) =>
                  setMinCount(Math.max(0, Number(event.target.value) || 0))
                }
                aria-label="Minimum COUNT rows"
              />
            </label>
          </div>
        </section>
      </div>

      {isPending ? (
        <div className="text-sm text-slate-500">Loading athletes...</div>
      ) : (
        <AggregateResultsTable filterBy={filterBy} havingBy={havingBy} />
      )}
    </div>
  );
}

function AggregateResultsTable({
  filterBy,
  havingBy,
}: {
  filterBy: Selection;
  havingBy: Selection;
}) {
  const columns = useMemo<Array<ColumnDef<AggregateRow>>>(
    () => [
      {
        accessorKey: 'nationality',
        header: ({ column }) => (
          <RenderTableHeader
            column={column}
            title="Nationality"
            view="shadcn-1"
          />
        ),
      },
      {
        accessorKey: 'total_gold',
        header: ({ column }) => (
          <RenderTableHeader
            column={column}
            title="SUM(gold)"
            view="shadcn-1"
          />
        ),
      },
      {
        accessorKey: 'athlete_count',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="COUNT(*)" view="shadcn-1" />
        ),
      },
    ],
    [],
  );

  const tableSource = useMemo(
    () =>
      ({
        where,
        having,
      }: {
        where: FilterExpr | null;
        having: FilterExpr | null;
      }) => {
        const query = mSql.Query.from(tableName)
          .select({
            nationality: mSql.column('nationality'),
            total_gold: mSql.sql`COALESCE(SUM(gold), 0)`,
            athlete_count: mSql.count(),
          })
          .where(mSql.isNotNull(mSql.column('nationality')))
          .groupby('nationality')
          .orderby(mSql.desc(mSql.column('total_gold')));

        if (where) {
          query.where(where);
        }

        if (having) {
          query.having(having);
        }

        return query;
      },
    [],
  );

  const { tableOptions, client } = useMosaicReactTable<AggregateRow>({
    table: tableSource,
    filterBy,
    havingBy,
    columns,
    converter: (row) => ({
      nationality: String(row.nationality ?? ''),
      total_gold: coerceNumber(row.total_gold),
      athlete_count: coerceNumber(row.athlete_count),
    }),
    tableOptions: {
      enableSorting: true,
    },
    totalRowsMode: 'window',
    __debugName: 'AggregateFilterLab',
  });

  const table = useReactTable(tableOptions);

  return (
    <div className="grid gap-2" data-testid="aggregate-filter-lab-results">
      <div
        className="text-sm text-slate-600"
        data-testid="aggregate-filter-summary"
      >
        Visible groups: {client.store.state.rows.length}
      </div>
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
