// examples/react/trimmed/src/components/views/nozzle-paa.tsx

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import { useReactTable } from '@tanstack/react-table';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { useMosaicValue } from '@/hooks/useMosaicValue';
import {
  ArraySelectFilter,
  DateRangeFilter,
  SearchableSelectFilter,
  TextFilter,
} from '@/components/paa/paa-filters';

const TABLE_NAME = 'nozzle_paa';
const PARQUET_PATH = '/data-proxy/nozzle_test.parquet';

// --- 1. Global State Topology ---

// A. Input Filter: Top-Bar Inputs
// CHANGED: Now a Cross-Filter.
// This allows inputs to filter *each other* while preserving the user's ability
// to change a selection (by seeing all options for the active dropdown).
const $inputFilter = vg.Selection.crossfilter();

// B. Detail Filter: Bottom Table In-Column Filters
const $detailFilter = vg.Selection.intersect();

// C. Cross Filter: Summary Table Row Clicks (Peers)
const $crossFilter = vg.Selection.crossfilter();

// --- Derived Contexts ---

// NEW: External Context
// The "Rest of the World" from the perspective of the Input Layer.
const $externalContext = vg.Selection.intersect({
  include: [$detailFilter, $crossFilter],
});

// For Summary Tables:
// They must respect Inputs AND Detail Table Filters.
// They use $crossFilter for Highlighting (Peers filter, Self highlights).
const $summaryContext = vg.Selection.intersect({
  include: [$inputFilter, $detailFilter],
});

// For Detail Table:
// It must respect Inputs AND Summary Table Clicks.
// It generates $detailFilter.
const $detailContext = vg.Selection.intersect({
  include: [$inputFilter, $crossFilter],
});

// For KPIs:
// They represent the "Total State" - Intersection of everything.
const $globalContext = vg.Selection.intersect({
  include: [$inputFilter, $detailFilter, $crossFilter],
});

export function NozzlePaaView() {
  const [isReady, setIsReady] = useState(false);

  // --- 2. Data Initialization ---
  useEffect(() => {
    async function init() {
      try {
        const parquetUrl = new URL(PARQUET_PATH, window.location.origin).href;

        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${TABLE_NAME} AS SELECT * FROM read_parquet('${parquetUrl}')`,
          ]);
        setIsReady(true);
      } catch (err) {
        console.warn('NozzlePaaView init interrupted or failed:', err);
      }
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

      {/* Filter Controls: Update $inputFilter */}
      {/* We pass 'selection' (Output) and 'filterBy' (Input/Context) */}
      <div className="px-6 -mt-8 relative z-10">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-wrap gap-6 items-center">
          <div className="text-sm font-bold text-slate-700 mr-2">
            FILTER BY:
          </div>

          <SearchableSelectFilter
            label="Domain"
            table={TABLE_NAME}
            column="domain"
            selection={$inputFilter}
            filterBy={$inputFilter}
            externalContext={$externalContext}
          />
          <TextFilter
            label="Phrase"
            table={TABLE_NAME}
            column="phrase"
            selection={$inputFilter}
            filterBy={$inputFilter}
          />
          <ArraySelectFilter
            label="Keyword Group"
            table={TABLE_NAME}
            column="keyword_groups"
            selection={$inputFilter}
            filterBy={$inputFilter}
            externalContext={$externalContext}
          />
          <TextFilter
            label="Answer Contains"
            table={TABLE_NAME}
            column="description"
            selection={$inputFilter}
            filterBy={$inputFilter}
          />
          <DateRangeFilter
            label="Requested Date"
            table={TABLE_NAME}
            column="requested"
            selection={$inputFilter}
            filterBy={$inputFilter}
          />
          <SearchableSelectFilter
            label="Device"
            table={TABLE_NAME}
            column="device"
            selection={$inputFilter}
            filterBy={$inputFilter}
            externalContext={$externalContext}
          />
          <TextFilter
            label="Question Contains"
            table={TABLE_NAME}
            column="related_phrase.phrase"
            selection={$inputFilter}
            filterBy={$inputFilter}
          />
        </div>
      </div>

      {/* Summary Grids */}
      {/* Topology: Filter By $summaryContext, Highlight By $crossFilter */}
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
      {/* Topology: Filter By $detailContext, Output To $detailFilter */}
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

  // KPIs use $globalContext to reflect ALL current filters
  const valPhrases = useMosaicValue(qPhrases, $globalContext);
  const valQuestions = useMosaicValue(qQuestions, $globalContext);
  const valDays = useMosaicValue(qDays, $globalContext);

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
  const safeId = groupBy.replace(/\./g, '_');

  const queryFactory = useMemo(
    () => (filter: any) => {
      let groupKey;
      if (groupBy.includes('.')) {
        const [col, field] = groupBy.split('.');
        groupKey = mSql.sql`${mSql.column(col)}.${mSql.sql([field] as any)}`;
      } else {
        groupKey = mSql.column(groupBy);
      }

      // MANUAL HIGHLIGHT LOGIC:
      // We calculate highlight status INSIDE the subquery where we have access
      // to all columns (like "related_phrase"."phrase").
      // This bypasses the "Column not found" error in the outer query.

      // Get the highlight predicate (Global Truth)
      const highlightPred = $crossFilter.predicate(null);

      // If we have a predicate, calculate MAX(CASE WHEN...).
      // If not, default to 1 (all highlighted).
      let highlightCol;

      // Robust check: Ensure predicate exists AND is not an empty array
      const hasPred =
        highlightPred &&
        (!Array.isArray(highlightPred) || highlightPred.length > 0);

      if (hasPred) {
        // Ensure the predicate is a valid SQL Node for interpolation.
        // If highlightPredicate is an array (implicit AND), wrap it.
        const safePredicate = Array.isArray(highlightPred)
          ? mSql.and(...highlightPred)
          : highlightPred;

        highlightCol = mSql.max(
          mSql.sql`CASE WHEN ${safePredicate} THEN 1 ELSE 0 END`,
        );
      } else {
        highlightCol = mSql.literal(1);
      }

      const q = mSql.Query.from(TABLE_NAME)
        .select({
          [safeId]: groupKey,
          metric: metric === '*' ? aggFn() : aggFn(metric),
          // Export computed highlight column
          __is_highlighted: highlightCol,
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
      // FILTER BY Inputs AND Detail Table
      filterBy: $summaryContext,
      // HIGHLIGHT BY Peers (Cross-filtering)
      highlightBy: $crossFilter,
      // NEW: Tell Core we handled it manually
      manualHighlight: true,
      columns: [],
      tableOptions: baseTableOptions,
    }),
    [queryFactory, baseTableOptions],
  );

  const { tableOptions, client } = useMosaicReactTable(mosaicOptions);
  const selectedValue = useSelectionValue($crossFilter, client);

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
        id: groupBy,
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

  useEffect(() => {
    client.updateOptions({
      columns,
      table: queryFactory,
      filterBy: $summaryContext,
      highlightBy: $crossFilter,
      manualHighlight: true, // Also updated here
      tableOptions: baseTableOptions,
      debugName: `${title}SummaryTable`,
    });
  }, [columns, client, queryFactory, baseTableOptions, title]);

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
            const value = row.getValue(groupBy);
            const column = groupBy;

            if (selectedValue === value) {
              $crossFilter.update({
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

              $crossFilter.update({
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
    () =>
      [
        {
          id: 'domain',
          accessorKey: 'domain',
          header: 'Domain',
          size: 150,
          meta: {
            mosaicDataTable: {
              sqlFilterType: 'PARTIAL_ILIKE',
            },
          },
        },
        {
          id: 'paa_question',
          accessorFn: (row) => row['related_phrase.phrase'],
          header: 'PAA Question',
          size: 350,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'related_phrase.phrase',
              sqlFilterType: 'PARTIAL_ILIKE' as const,
            },
          },
        },
        {
          id: 'title',
          accessorKey: 'title',
          header: 'Answer Title',
          size: 300,
          meta: {
            mosaicDataTable: {
              sqlFilterType: 'PARTIAL_ILIKE' as const,
            },
          },
        },
        {
          id: 'description',
          accessorKey: 'description',
          header: 'Answer Description',
          size: 400,
          meta: {
            mosaicDataTable: {
              sqlFilterType: 'PARTIAL_ILIKE' as const,
            },
          },
        },
      ] satisfies Array<ColumnDef<any, any>>,
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
      // FILTER BY Inputs AND Cross-Filter Clicks
      filterBy: $detailContext,
      // PUBLISH TO $detailFilter (So summary tables update)
      tableFilterSelection: $detailFilter,
      columns,
      totalRowsColumnName: '__total_rows',
      tableOptions: {
        ...baseTableOptions,
        enableColumnFilters: true,
      },
      debugName: 'DetailTable',
    }),
    [columns, baseTableOptions],
  );

  const { tableOptions } = useMosaicReactTable(mosaicOptions);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={columns} />;
}
