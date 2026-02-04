/**
 * View component for the Nozzle PAA dataset.
 * Features: KPI Cards, Complex Filtering, and Multi-Table Cross-Filtering.
 */
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import { useReactTable } from '@tanstack/react-table';
import {
  coerceNumber,
  createMosaicColumnHelper,
  createMosaicMapping,
  useMosaicReactTable,
} from '@nozzleio/mosaic-tanstack-react-table';
import {
  useConnectorStatus,
  useCoordinator,
  useFilterRegistry,
  useRegisterFilterSource,
} from '@nozzleio/react-mosaic';
import type { ColumnDef } from '@tanstack/react-table';
import type { AggregateNode, FilterExpr } from '@uwdata/mosaic-sql';
import type { Selection } from '@uwdata/mosaic-core';
import { usePaaTopology } from '@/hooks/usePaaTopology';
import { RenderTable } from '@/components/render-table';
import { useMosaicValue } from '@/hooks/useMosaicValue';
import {
  ArraySelectFilter,
  DateRangeFilter,
  SearchableSelectFilter,
  TextFilter,
} from '@/components/paa/paa-filters';
import { ActiveFilterBar } from '@/components/active-filter-bar';

const TABLE_NAME = 'nozzle_paa';

// Data Sources
// 1. Remote: Public URL (Go server fetches this directly)
const REMOTE_URL = 'https://fastopendata.org/nozzle_test.parquet';
// 2. WASM: Local Proxy Path (Browser fetches this via Vite -> fastopendata.org to bypass CORS)
const PROXY_PATH = '/data-proxy/nozzle_test.parquet';

// --- MAIN DETAIL TABLE ---
interface PaaRowData {
  domain: string | null;
  paa_question: string | null;
  title: string | null;
  description: string | null;
}

const PaaMapping = createMosaicMapping<PaaRowData>({
  domain: { sqlColumn: 'domain', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  paa_question: {
    sqlColumn: 'related_phrase.phrase',
    type: 'VARCHAR',
    filterType: 'PARTIAL_ILIKE',
  },
  title: { sqlColumn: 'title', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  description: {
    sqlColumn: 'description',
    type: 'VARCHAR',
    filterType: 'PARTIAL_ILIKE',
  },
});

// --- SUMMARY TABLE SCHEMAS (Generic for GroupBy queries) ---
interface GroupByRow {
  key: string | number | null;
  metric: number | null;
  __is_highlighted?: number;
}

const GroupByMapping = createMosaicMapping<GroupByRow>({
  key: { sqlColumn: 'key', type: 'VARCHAR', filterType: 'EQUALS' },
  metric: { sqlColumn: 'metric', type: 'INTEGER', filterType: 'RANGE' },
  __is_highlighted: {
    sqlColumn: '__is_highlighted',
    type: 'INTEGER',
    filterType: 'EQUALS',
  },
});

export function NozzlePaaView() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coordinator = useCoordinator();
  const { mode } = useConnectorStatus();
  const topology = usePaaTopology();
  const filterRegistry = useFilterRegistry();

  // Stable Aggregation Function for Phrase Table
  const maxAgg = useMemo(() => (e: any) => mSql.max(e), []);

  // Stable Where Clauses
  const whereDomain = useMemo(() => mSql.sql`domain IS NOT NULL`, []);
  const whereUrl = useMemo(() => mSql.sql`url IS NOT NULL`, []);

  // Register Filter Groups on mount
  useEffect(() => {
    filterRegistry.registerGroup({
      id: 'global',
      label: 'Global Controls',
      priority: 1,
    });
    filterRegistry.registerGroup({
      id: 'summary',
      label: 'Summary Selections',
      priority: 2,
    });
    filterRegistry.registerGroup({
      id: 'detail',
      label: 'Detail Filters',
      priority: 3,
    });
  }, [filterRegistry]);

  // Register Top-Level Selections Individually
  useRegisterFilterSource(topology.inputs.domain, 'global', {
    labelMap: { domain: 'Domain' },
  });
  useRegisterFilterSource(topology.inputs.phrase, 'global', {
    labelMap: { phrase: 'Keyword' },
  });
  useRegisterFilterSource(topology.inputs.keywordGroup, 'global', {
    labelMap: { keyword_groups: 'Keyword Group' },
  });
  useRegisterFilterSource(topology.inputs.desc, 'global', {
    labelMap: { description: 'Answer Text' },
  });
  useRegisterFilterSource(topology.inputs.date, 'global', {
    labelMap: { requested: 'Date Range' },
  });
  useRegisterFilterSource(topology.inputs.device, 'global', {
    labelMap: { device: 'Device' },
  });
  useRegisterFilterSource(topology.inputs.question, 'global', {
    labelMap: { 'related_phrase.phrase': 'Question' },
  });

  // Register Summary Table Output Selections
  useRegisterFilterSource(topology.selections.phrase, 'summary', {
    labelMap: { phrase: 'Selected Keyword' },
  });
  useRegisterFilterSource(topology.selections.question, 'summary', {
    labelMap: { 'related_phrase.phrase': 'Selected Question' },
  });
  useRegisterFilterSource(topology.selections.domain, 'summary', {
    labelMap: { domain: 'Selected Domain' },
  });
  useRegisterFilterSource(topology.selections.url, 'summary', {
    labelMap: { url: 'Selected URL' },
  });

  // Register Detail Table Column Filters
  useRegisterFilterSource(topology.detail, 'detail');

  useEffect(() => {
    let active = true;
    // Simple retry mechanism for "Cleared" errors which can happen if init overlaps with a connector switch
    let retryCount = 0;

    async function init() {
      try {
        setError(null);

        // Determine the correct URL based on the connection mode
        // Remote: Needs absolute URL to fetch from internet
        // WASM: Needs relative URL to fetch via Vite Proxy (to bypass CORS)
        const parquetUrl =
          mode === 'remote'
            ? REMOTE_URL
            : new URL(PROXY_PATH, window.location.origin).href;

        await coordinator.exec([
          `CREATE OR REPLACE TABLE ${TABLE_NAME} AS SELECT * FROM read_parquet('${parquetUrl}')`,
        ]);

        if (active) {
          setIsReady(true);
        }
      } catch (err: any) {
        if (!active) {
          return;
        }

        console.warn('NozzlePaaView init interrupted or failed:', err);
        const errMsg = err.message || String(err);

        // If the error is "Cleared", it means the coordinator reset while we were querying.
        // We can try once more after a short delay.
        if (errMsg.includes('Cleared') && retryCount < 1) {
          console.log('Retrying init...');
          retryCount++;
          setTimeout(init, 500);
          return;
        }

        setError(errMsg);
      }
    }
    init();

    return () => {
      active = false;
    };
  }, [coordinator, mode]);

  if (error) {
    return (
      <div className="flex h-64 flex-col gap-4 items-center justify-center text-red-500">
        <div className="font-bold text-lg">Initialization Failed</div>
        <p className="text-sm max-w-md text-center bg-red-50 p-2 rounded border border-red-100">
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300 text-slate-800 text-sm font-medium"
        >
          Reload Page
        </button>
      </div>
    );
  }

  // Render optimistically. We no longer block on isReady.
  // Instead, we pass isReady to child components to suppress queries until data is loaded.
  return (
    <div className="flex flex-col gap-6 bg-slate-50/50 min-h-screen pb-10">
      <HeaderSection topology={topology} enabled={isReady} />

      {/* Insert Active Filter Bar Here */}
      <ActiveFilterBar />

      <div className="px-6 -mt-8 relative z-10">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-wrap gap-6 items-center">
          <div className="text-sm font-bold text-slate-700 mr-2">
            FILTER BY:
          </div>
          <SearchableSelectFilter
            label="Domain"
            table={TABLE_NAME}
            column="domain"
            selection={topology.inputs.domain}
            filterBy={topology.inputContexts.domain}
            externalContext={topology.externalContext}
          />
          <TextFilter
            label="Phrase"
            table={TABLE_NAME}
            column="phrase"
            selection={topology.inputs.phrase}
          />
          <ArraySelectFilter
            label="Keyword Group"
            table={TABLE_NAME}
            column="keyword_groups"
            selection={topology.inputs.keywordGroup}
            filterBy={topology.inputContexts.keywordGroup}
            externalContext={topology.externalContext}
          />
          <TextFilter
            label="Answer Contains"
            table={TABLE_NAME}
            column="description"
            selection={topology.inputs.desc}
          />
          <DateRangeFilter
            label="Requested Date"
            table={TABLE_NAME}
            column="requested"
            selection={topology.inputs.date}
          />
          <SearchableSelectFilter
            label="Device"
            table={TABLE_NAME}
            column="device"
            selection={topology.inputs.device}
            filterBy={topology.inputContexts.device}
            externalContext={topology.externalContext}
          />
          <TextFilter
            label="Question Contains"
            table={TABLE_NAME}
            column="related_phrase.phrase"
            selection={topology.inputs.question}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6 px-6">
        <SummaryTable
          title="Keyword Phrase"
          groupBy="phrase"
          metric="search_volume"
          metricLabel="Search Vol"
          aggFn={maxAgg}
          filterBy={topology.phraseContext}
          selection={topology.selections.phrase}
          enabled={isReady}
        />
        <SummaryTable
          title="PAA Questions"
          groupBy="related_phrase.phrase"
          metric="*"
          metricLabel="SERP Appears"
          aggFn={mSql.count}
          filterBy={topology.questionContext}
          selection={topology.selections.question}
          enabled={isReady}
        />
        <SummaryTable
          title="Domain"
          groupBy="domain"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={whereDomain}
          filterBy={topology.domainContext}
          selection={topology.selections.domain}
          enabled={isReady}
        />
        <SummaryTable
          title="URL"
          groupBy="url"
          metric="*"
          metricLabel="# of Answers"
          aggFn={mSql.count}
          where={whereUrl}
          filterBy={topology.urlContext}
          selection={topology.selections.url}
          enabled={isReady}
        />
      </div>

      <div className="flex-1 px-6 min-h-[500px]">
        <div className="bg-white border rounded-lg shadow-sm h-full flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-slate-50/50 font-semibold text-slate-800">
            Detailed Breakdown
          </div>
          <div className="flex-1 overflow-auto p-0">
            <DetailTable topology={topology} enabled={isReady} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderSection({
  topology,
  enabled,
}: {
  topology: ReturnType<typeof usePaaTopology>;
  enabled: boolean;
}) {
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

  // KPIs use the Global Context (All Inputs + All Summaries + Detail)
  const valPhrases = useMosaicValue(qPhrases, topology.globalContext, {
    enabled,
  });
  const valQuestions = useMosaicValue(qQuestions, topology.globalContext, {
    enabled,
  });
  const valDays = useMosaicValue(qDays, topology.globalContext, { enabled });

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

type AggregationFactory = (expression?: any) => AggregateNode;

function SummaryTable({
  title,
  groupBy,
  metric,
  metricLabel,
  aggFn,
  where,
  filterBy,
  selection,
  enabled,
}: {
  title: string;
  groupBy: string;
  metric: string;
  metricLabel: string;
  aggFn: AggregationFactory;
  where?: FilterExpr;
  filterBy: Selection;
  selection: Selection;
  enabled: boolean;
}) {
  const queryFactory = useMemo(
    () => (filter: FilterExpr | null | undefined) => {
      let groupKey;
      if (groupBy.includes('.')) {
        const [col, field] = groupBy.split('.');
        groupKey = mSql.sql`${mSql.column(col!)}.${mSql.sql([field!] as any)}`;
      } else {
        groupKey = mSql.column(groupBy);
      }

      const highlightPred = selection.predicate(null);
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
          key: groupKey,
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
    [groupBy, metric, aggFn, where, selection],
  );

  const helper = useMemo(() => createMosaicColumnHelper<GroupByRow>(), []);

  const columns = useMemo(
    () => [
      {
        id: 'select',
        header: '',
        size: 30,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer size-4"
            />
          </div>
        ),
      } as ColumnDef<GroupByRow, unknown>,
      helper.accessor('key', {
        id: 'key',
        header: title,
        enableColumnFilter: false,
      }),
      helper.accessor('metric', {
        id: 'metric',
        header: metricLabel,
        cell: (info) => info.getValue()?.toLocaleString(),
        enableColumnFilter: false,
      }),
      helper.accessor('__is_highlighted', {
        id: '__is_highlighted',
        header: '',
        meta: {
          mosaicDataTable: {
            sqlColumn: '__is_highlighted',
          },
        },
      }),
    ],
    [groupBy, title, metricLabel, helper],
  );

  const { tableOptions } = useMosaicReactTable<GroupByRow>({
    table: queryFactory,
    filterBy: filterBy,
    manualHighlight: true,
    totalRowsMode: 'split',
    rowSelection: {
      selection: selection,
      column: groupBy as keyof GroupByRow,
      columnType: 'scalar',
    },
    columns,
    mapping: GroupByMapping,
    converter: (row) =>
      ({
        ...row,
        metric: coerceNumber(row.metric),
        __is_highlighted: coerceNumber(row.__is_highlighted),
      }) as GroupByRow,
    tableOptions: {
      initialState: {
        sorting: [{ id: 'metric', desc: true }],
        pagination: { pageSize: 10 },
        columnVisibility: { __is_highlighted: false },
      },
      getRowId: (row) => String(row.key),
      enableRowSelection: true,
      enableMultiRowSelection: true,
    },
    __debugName: `${title}SummaryTable`,
    enabled,
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
          onRowClick={(row) => row.toggleSelected()}
        />
      </div>
    </div>
  );
}

function DetailTable({
  topology,
  enabled,
}: {
  topology: ReturnType<typeof usePaaTopology>;
  enabled: boolean;
}) {
  const helper = useMemo(() => createMosaicColumnHelper<PaaRowData>(), []);

  const columns = useMemo(
    () => [
      helper.accessor('domain', { header: 'Domain', size: 150 }),
      helper.accessor('paa_question', {
        header: 'PAA Question',
        size: 350,
      }),
      helper.accessor('title', { header: 'Answer Title', size: 300 }),
      helper.accessor('description', {
        header: 'Answer Description',
        size: 400,
      }),
    ],
    [helper],
  );

  const { tableOptions } = useMosaicReactTable<PaaRowData>({
    table: TABLE_NAME,
    filterBy: topology.detailContext,
    tableFilterSelection: topology.detail,
    columns,
    mapping: PaaMapping,
    totalRowsColumnName: '__total_rows',
    totalRowsMode: 'split',
    tableOptions: {
      initialState: { pagination: { pageSize: 20 } },
      enableColumnFilters: true,
    },
    __debugName: 'DetailTable',
    enabled,
  });

  const table = useReactTable(tableOptions);
  return <RenderTable table={table} columns={columns} />;
}
