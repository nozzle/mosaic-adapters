/**
 * View component for the Nozzle PAA dataset.
 * Uses 'split' pagination mode to ensure memory safety on potentially large SEO datasets.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import { useReactTable } from '@tanstack/react-table';
import {
  MosaicFacetGroup,
  useMosaicReactTable,
  useMosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import { PaaDashboardModel } from './paa-model';
import type { ColumnDef } from '@tanstack/react-table';
import type { AggregateNode, FilterExpr } from '@uwdata/mosaic-sql';
import { RenderTable } from '@/components/render-table';
import { useMosaicValue } from '@/hooks/useMosaicValue';
import {
  ConsolidatedSearchableSelectFilter,
  DateRangeFilter,
  TextFilter,
} from '@/components/paa/paa-filters';

const TABLE_NAME = 'nozzle_paa';
const PARQUET_PATH = '/data-proxy/nozzle_test.parquet';

export function NozzlePaaView() {
  const [isReady, setIsReady] = useState(false);

  const model = useMosaicViewModel<PaaDashboardModel>(
    (c) => new PaaDashboardModel(c),
    vg.coordinator(),
  );

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
      <HeaderSection model={model} />

      <div className="px-6 -mt-8 relative z-10">
        <MosaicFacetGroup
          table={TABLE_NAME}
          filterBy={model.selections.input}
          coordinator={vg.coordinator()}
          __debugName="PaaSidebar"
        >
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-wrap gap-6 items-center">
            <div className="text-sm font-bold text-slate-700 mr-2">
              FILTER BY:
            </div>

            <ConsolidatedSearchableSelectFilter
              label="Domain"
              column="domain"
            />
            <TextFilter
              label="Phrase"
              table={TABLE_NAME}
              column="phrase"
              selection={model.selections.input}
              filterBy={model.selections.input}
            />
            <ConsolidatedSearchableSelectFilter
              label="Keyword Group"
              column="keyword_groups"
              columnType="array"
            />
            <TextFilter
              label="Answer Contains"
              table={TABLE_NAME}
              column="description"
              selection={model.selections.input}
              filterBy={model.selections.input}
            />
            <DateRangeFilter
              label="Requested Date"
              table={TABLE_NAME}
              column="requested"
              selection={model.selections.input}
              filterBy={model.selections.input}
            />
            <ConsolidatedSearchableSelectFilter
              label="Device"
              column="device"
            />
            <TextFilter
              label="Question Contains"
              table={TABLE_NAME}
              column="related_phrase.phrase"
              selection={model.selections.input}
              filterBy={model.selections.input}
            />
          </div>
        </MosaicFacetGroup>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6 px-6">
        <SummaryTable
          model={model}
          title="Keyword Phrase"
          groupBy="phrase"
          metric="search_volume"
          metricLabel="Search Vol"
          aggFn={mSql.max}
        />
        <SummaryTable
          model={model}
          title="PAA Questions"
          groupBy="related_phrase.phrase"
          metric="*"
          metricLabel="SERP Appears"
          aggFn={mSql.count}
        />
        <SummaryTable
          model={model}
          title="Domain"
          groupBy="domain"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={mSql.sql`domain IS NOT NULL`}
        />
        <SummaryTable
          model={model}
          title="URL"
          groupBy="url"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={mSql.sql`url IS NOT NULL`}
        />
      </div>

      <div className="flex-1 px-6 min-h-[500px]">
        <div className="bg-white border rounded-lg shadow-sm h-full flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-slate-50/50 font-semibold text-slate-800">
            Detailed Breakdown
          </div>
          <div className="flex-1 overflow-auto p-0">
            <DetailTable model={model} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderSection({ model }: { model: PaaDashboardModel }) {
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

  const valPhrases = useMosaicValue(
    qPhrases,
    model.selections.globalContext as any,
  );
  const valQuestions = useMosaicValue(
    qQuestions,
    model.selections.globalContext as any,
  );
  const valDays = useMosaicValue(qDays, model.selections.globalContext as any);

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

function SummaryTable({
  model,
  title,
  groupBy,
  metric,
  metricLabel,
  aggFn,
  where,
}: {
  model: PaaDashboardModel;
  title: string;
  groupBy: string;
  metric: string;
  metricLabel: string;
  aggFn: (expression?: any) => AggregateNode;
  where?: FilterExpr;
}) {
  const safeId = groupBy.replace(/\./g, '_');

  const queryFactory = useMemo(
    () => (filter: FilterExpr | null | undefined) => {
      let groupKey;
      if (groupBy.includes('.')) {
        const [col, field] = groupBy.split('.');
        groupKey = mSql.sql`${mSql.column(col!)}.${mSql.sql([field!] as any)}`;
      } else {
        groupKey = mSql.column(groupBy);
      }

      const highlightPred = model.selections.cross.predicate(null);

      let highlightCol;
      const hasPred =
        highlightPred &&
        (!Array.isArray(highlightPred) || highlightPred.length > 0);

      if (hasPred) {
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
    [groupBy, metric, aggFn, where, safeId, model.selections.cross],
  );

  const baseTableOptions = useMemo(
    () => ({
      initialState: {
        sorting: [{ id: 'metric', desc: true }],
        pagination: { pageSize: 10 },
      },
      getRowId: (row: any) => String(row[safeId]),
      enableRowSelection: true,
      enableMultiRowSelection: true,
    }),
    [safeId],
  );

  const { tableOptions } = useMosaicReactTable({
    table: queryFactory,
    filterBy: model.selections.summaryContext,
    highlightBy: model.selections.cross,
    manualHighlight: true,
    // Explicitly use 'split' mode for summary grids to keep memory footprint predictable.
    totalRowsMode: 'split',
    rowSelection: {
      selection: model.selections.cross,
      column: groupBy,
      columnType: 'scalar',
    },
    columns: useMemo(
      () => [
        {
          id: 'select',
          header: '',
          size: 30,
          enableSorting: false,
          enableColumnFilter: false,
          enableHiding: false,
          cell: ({ row }: any) => {
            return (
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={row.getIsSelected()}
                  onChange={row.getToggleSelectedHandler()}
                  onClick={(e) => e.stopPropagation()}
                  className="cursor-pointer size-4"
                />
              </div>
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
      [groupBy, title, metricLabel, safeId],
    ),
    tableOptions: baseTableOptions,
    __debugName: `${title}SummaryTable`,
  });

  const table = useReactTable(tableOptions);

  return (
    <div className="bg-white border rounded-lg shadow-sm flex flex-col h-[350px] overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50 text-sm font-bold text-slate-700 uppercase tracking-wide">
        {title}
      </div>
      <div className="flex-1 overflow-auto p-2">
        <RenderTable
          table={table}
          columns={tableOptions.columns}
          onRowClick={(row) => {
            row.toggleSelected();
          }}
        />
      </div>
    </div>
  );
}

interface PaaRowData {
  domain: string;
  'related_phrase.phrase': string;
  title: string;
  description: string;
}

function DetailTable({ model }: { model: PaaDashboardModel }) {
  const columns = useMemo(
    () =>
      [
        {
          id: 'domain',
          accessorKey: 'domain',
          header: 'Domain',
          size: 150,
          meta: {
            mosaicDataTable: model.getColumnMeta('domain'),
          },
        },
        {
          id: 'paa_question',
          accessorFn: (row) => row['related_phrase.phrase'],
          header: 'PAA Question',
          size: 350,
          meta: {
            mosaicDataTable: model.getColumnMeta('paa_question'),
          },
        },
        {
          id: 'title',
          accessorKey: 'title',
          header: 'Answer Title',
          size: 300,
          meta: {
            mosaicDataTable: model.getColumnMeta('title'),
          },
        },
        {
          id: 'description',
          accessorKey: 'description',
          header: 'Answer Description',
          size: 400,
          meta: {
            mosaicDataTable: model.getColumnMeta('description'),
          },
        },
      ] satisfies Array<ColumnDef<PaaRowData, any>>,
    [model],
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
      filterBy: model.selections.detailContext,
      tableFilterSelection: model.selections.detail,
      columns,
      totalRowsColumnName: '__total_rows',
      // Explicitly use 'split' mode for PAA Detail Table for maximum stability.
      totalRowsMode: 'split' as const,
      tableOptions: {
        ...baseTableOptions,
        enableColumnFilters: true,
      },
      __debugName: 'DetailTable',
    }),
    [columns, baseTableOptions, model],
  );

  const { tableOptions } = useMosaicReactTable(mosaicOptions);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={columns} />;
}
