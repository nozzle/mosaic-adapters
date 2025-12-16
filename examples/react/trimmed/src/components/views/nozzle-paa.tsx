// The main PAA Report view containing KPIs, Filters, Summary Tables, and Detail Table.

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import { useReactTable } from '@tanstack/react-table';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import { RenderTable } from '@/components/render-table';
import { useMosaicValue } from '@/hooks/useMosaicValue';
import {
  ArraySelectFilter,
  DateRangeFilter,
  SelectFilter,
  TextFilter,
} from '@/components/paa/paa-filters';

const TABLE_NAME = 'nozzle_paa';
const PARQUET_PATH = '/data-proxy/nozzle_test.parquet';

// --- 1. Global State Definition ---
// This selection is the "Brain" of the dashboard. All inputs write to it.
// All tables read from it.
const $globalFilter = vg.Selection.crossfilter();

export function NozzlePaaView() {
  const [isReady, setIsReady] = useState(false);

  // --- 2. Data Initialization ---
  useEffect(() => {
    async function init() {
      const connector = vg.wasmConnector({ log: false });
      vg.coordinator().databaseConnector(connector);

      // FIX: Convert relative proxy path to absolute URL so DuckDB uses HTTPFS
      const parquetUrl = new URL(PARQUET_PATH, window.location.origin).href;

      await vg
        .coordinator()
        .exec([
          `CREATE OR REPLACE TABLE ${TABLE_NAME} AS SELECT * FROM read_parquet('${parquetUrl}')`,
        ]);
      setIsReady(true);
    }
    init();
  }, []);

  if (!isReady) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500 animate-pulse">
        Initializing DuckDB & Loading PAA Data...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 bg-slate-50/50 min-h-screen pb-10">
      {/* Header Section */}
      <HeaderSection />

      {/* Filter Controls */}
      <div className="px-6 -mt-8 relative z-10">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-wrap gap-6 items-center">
          <div className="text-sm font-bold text-slate-700 mr-2">
            FILTER BY:
          </div>

          <SelectFilter
            label="Domain"
            table={TABLE_NAME}
            column="domain"
            selection={$globalFilter}
          />
          <TextFilter
            label="Phrase"
            table={TABLE_NAME}
            column="phrase"
            selection={$globalFilter}
          />

          {/* NEW: Keyword Groups (Array) */}
          <ArraySelectFilter
            label="Keyword Group"
            table={TABLE_NAME}
            column="keyword_groups"
            selection={$globalFilter}
          />

          {/* NEW: Answer Contains (Description) */}
          <TextFilter
            label="Answer Contains"
            table={TABLE_NAME}
            column="description"
            selection={$globalFilter}
          />

          {/* NEW: Date Range */}
          <DateRangeFilter
            label="Requested Date"
            table={TABLE_NAME} // Prop needed for TS, though unused in DateRangeFilter logic
            column="requested"
            selection={$globalFilter}
          />

          <SelectFilter
            label="Device"
            table={TABLE_NAME}
            column="device"
            selection={$globalFilter}
          />
          <TextFilter
            label="Question Contains"
            table={TABLE_NAME}
            column="related_phrase.phrase"
            selection={$globalFilter}
          />
        </div>
      </div>

      {/* Summary Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6 px-6">
        <SummaryTable
          title="Keyword Phrase"
          groupBy="phrase"
          metric="search_volume"
          metricLabel="Search Vol"
          aggFn={mSql.max}
        />
        <SummaryTable
          title="PAA Questions"
          groupBy="related_phrase.phrase"
          metric="*"
          metricLabel="SERP Appears"
          aggFn={mSql.count}
        />
        <SummaryTable
          title="Domain"
          groupBy="domain"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={mSql.sql`domain IS NOT NULL`}
        />
        <SummaryTable
          title="URL"
          groupBy="url"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={mSql.sql`url IS NOT NULL`}
        />
      </div>

      {/* Detail Table */}
      <div className="flex-1 px-6 min-h-[500px]">
        <div className="bg-white border rounded-lg shadow-sm h-full flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-slate-50/50 font-semibold text-slate-800">
            Detailed Breakdown
          </div>
          <div className="flex-1 overflow-auto p-0">
            <DetailTable />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-Components ---

function HeaderSection() {
  const qPhrases = (filter: any) =>
    mSql.Query.from(TABLE_NAME)
      .select({ value: mSql.count('phrase').distinct() })
      .where(filter);

  const qQuestions = (filter: any) =>
    mSql.Query.from(TABLE_NAME)
      .select({
        value: mSql.count(mSql.sql`"related_phrase"."phrase"`).distinct(),
      })
      .where(filter);

  const qDays = (filter: any) =>
    mSql.Query.from(TABLE_NAME)
      .select({ value: mSql.count('requested').distinct() })
      .where(filter);

  const valPhrases = useMosaicValue(qPhrases, $globalFilter);
  const valQuestions = useMosaicValue(qQuestions, $globalFilter);
  const valDays = useMosaicValue(qDays, $globalFilter);

  return (
    <div className="bg-[#0e7490] text-white pt-8 pb-12 px-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-light tracking-wide">PAA Report</h1>
          <p className="text-cyan-100 text-sm mt-1">
            SEO Intelligence Dashboard
          </p>
        </div>
        <div className="flex flex-wrap gap-8 md:gap-12">
          <KpiCard label="# of Tracked Phrases" value={valPhrases} />
          <KpiCard label="# of Unique Questions" value={valQuestions} />
          <KpiCard label="# of Days" value={valDays} />
          <KpiCard label="# of Devices" value="2" />
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center md:text-right">
      <div className="text-xs uppercase tracking-wider text-cyan-200 font-semibold mb-1">
        {label}
      </div>
      <div className="text-3xl font-bold">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function useSelectionValue(selection: vg.Selection, client: any) {
  const [value, setValue] = useState(selection.valueFor(client));

  useEffect(() => {
    const handler = () => {
      setValue(selection.valueFor(client));
    };
    selection.addEventListener('value', handler);
    return () => selection.removeEventListener('value', handler);
  }, [selection, client]);

  return value;
}

function SummaryTable({
  title,
  groupBy,
  metric,
  metricLabel,
  aggFn,
  where,
}: any) {
  // Create a safe identifier for the alias/accessor.
  const safeId = groupBy.replace(/\./g, '_');

  // 1. Define the Query Factory
  const queryFactory = useMemo(
    () => (filter: any) => {
      let groupKey;
      if (groupBy.includes('.')) {
        const [col, field] = groupBy.split('.');
        groupKey = mSql.sql`${mSql.column(col)}.${mSql.sql([field] as any)}`;
      } else {
        groupKey = mSql.column(groupBy);
      }

      const q = mSql.Query.from(TABLE_NAME)
        .select({
          [safeId]: groupKey,
          metric: metric === '*' ? aggFn() : aggFn(metric),
        })
        .groupby(groupKey);

      if (filter) {
        q.where(filter);
      }
      if (where) {
        q.where(where);
      }

      return q;
    },
    [groupBy, metric, aggFn, where, safeId],
  );

  // Memoize options to prevent infinite render loops
  const baseTableOptions = useMemo(
    () => ({
      initialState: {
        sorting: [{ id: 'metric', desc: true }],
        pagination: { pageSize: 10 },
      },
    }),
    [],
  );

  const mosaicOptions = useMemo(
    () => ({
      table: queryFactory,
      highlightBy: $globalFilter,
      columns: [], // We provide columns via updateOptions
      tableOptions: baseTableOptions,
    }),
    [queryFactory, baseTableOptions],
  );

  // 3. Connect Adapter
  const { tableOptions, client } = useMosaicReactTable(mosaicOptions);

  // 4. Reactive Selection State for UI
  const selectedValue = useSelectionValue($globalFilter, client);

  // 2. Define Table Columns (Dynamic based on selectedValue)
  const columns = useMemo(
    () => [
      {
        id: 'select',
        header: '',
        size: 30,
        enableSorting: false,
        enableColumnFilter: false,
        enableHiding: false,
        cell: ({ row }: any) => {
          // FIX: Use groupBy (Column ID) not safeId (Accessor)
          // safeId is the SQL alias, groupBy is the Column Definition ID.
          // TanStack Table's row.getValue expects Column ID.
          const rowVal = row.getValue(groupBy);
          const isChecked = selectedValue === rowVal;
          return (
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              className="cursor-pointer size-4"
            />
          );
        },
      },
      {
        id: groupBy, // This ID must match what we pass to getValue above
        accessorKey: safeId,
        header: title,
        enableColumnFilter: false,
      },
      {
        id: 'metric',
        accessorKey: 'metric',
        header: metricLabel,
        cell: (info: any) => info.getValue()?.toLocaleString(),
        enableColumnFilter: false,
      },
    ],
    [groupBy, title, metricLabel, safeId, selectedValue],
  );

  // Update client columns when they change (due to selection state)
  useEffect(() => {
    client.updateOptions({
      columns,
      table: queryFactory,
      highlightBy: $globalFilter,
      tableOptions: baseTableOptions,
    });
  }, [columns, client, queryFactory, baseTableOptions]);

  const table = useReactTable(tableOptions);

  return (
    <div className="bg-white border rounded-lg shadow-sm flex flex-col h-[350px] overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50 text-sm font-bold text-slate-700 uppercase tracking-wide">
        {title}
      </div>
      <div className="flex-1 overflow-auto p-2">
        <RenderTable
          table={table}
          columns={columns}
          onRowClick={(row) => {
            // FIX: Use groupBy (Column ID) here too
            const value = row.getValue(groupBy);
            const column = groupBy;

            if (selectedValue === value) {
              $globalFilter.update({
                source: client,
                value: null,
                predicate: null,
              });
            } else {
              const predicate = mSql.eq(
                groupBy.includes('.')
                  ? mSql.sql`${mSql.column(groupBy.split('.')[0])}.${mSql.sql([groupBy.split('.')[1]] as any)}`
                  : mSql.column(column),
                mSql.literal(value),
              );

              $globalFilter.update({
                source: client,
                value: value,
                predicate,
              });
            }
          }}
        />
      </div>
    </div>
  );
}

function DetailTable() {
  const columns = useMemo(
    () => [
      {
        id: 'domain',
        accessorKey: 'domain',
        header: 'Domain',
        size: 150,
      },
      {
        id: 'paa_question',
        // FIX: Use the flattened key syntax because query-builder aliases struct fields to strings like "related_phrase.phrase"
        accessorFn: (row: any) => row['related_phrase.phrase'],
        header: 'PAA Question',
        size: 350,
        meta: {
          mosaicDataTable: {
            sqlColumn: 'related_phrase.phrase',
          },
        },
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: 'Answer Title',
        size: 300,
      },
      {
        id: 'description',
        accessorKey: 'description',
        header: 'Answer Description',
        size: 400,
      },
    ],
    [],
  );

  const baseTableOptions = useMemo(
    () => ({
      initialState: {
        pagination: { pageSize: 20 },
      },
    }),
    [],
  );

  const mosaicOptions = useMemo(
    () => ({
      table: TABLE_NAME,
      filterBy: $globalFilter,
      columns,
      totalRowsColumnName: '__total_rows',
      tableOptions: baseTableOptions,
    }),
    [columns, baseTableOptions],
  );

  const { tableOptions } = useMosaicReactTable(mosaicOptions);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={columns} />;
}