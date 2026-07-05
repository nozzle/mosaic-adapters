/**
 * The Nozzle PAA dashboard on the data-client stack (issue #165): KPI
 * header, four cross-filtering group-by summary tables with row-select
 * publishing, in-widget selection chips, and per-card metric-threshold
 * (HAVING + membership) filters, the min-domains subquery filter, top-bar
 * facet/text/date inputs, an active-filter chip bar with global reset, a
 * sparkline column, and a detail table with bridged column filters — all on
 * a static Selection topology composed with native `include` lists
 * (page-context.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { Query, column, count, isNotNull, sql } from '@uwdata/mosaic-sql';
import { useMosaicValues } from '@nozzleio/react-mosaic';
import { initPaaTable } from './mosaic-setup';
import { $page, tableName } from './page-context';
import { ActiveFilterBar } from './components/active-filter-bar';
import { DetailTable } from './components/detail-table';
import { FilterBuilder } from './components/filter-builder';
import {
  DateRangeFilter,
  DeviceFilter,
  DomainFilter,
  KeywordGroupFilter,
  QuestionMinDomainsFilter,
  TextFilter,
} from './components/paa-filters';
import {
  MetricThresholdControls,
  useMetricThresholdFilter,
} from './components/metric-threshold-filter';
import {
  SummaryTable,
  SummaryTablePlaceholder,
} from './components/summary-table';
import type { MetricThresholdFilterState } from './components/metric-threshold-filter';
import type { SummaryTableConfig } from './components/summary-table';
import type { SummaryTableId } from './page-context';

const summaryTables: Array<SummaryTableConfig> = [
  {
    id: 'phrase',
    title: 'Keyword Phrase',
    groupBy: 'phrase',
    metricLabel: 'Search Vol',
    metric: { agg: 'max', column: 'search_volume' },
    sparkline: {
      x: { column: 'requested', interval: 'day' },
      y: { agg: 'max', column: 'search_volume' },
    },
  },
  {
    id: 'question',
    title: 'PAA Questions',
    groupBy: 'related_phrase.phrase',
    metricLabel: 'SERP Appears',
    metric: { agg: 'count' },
  },
  {
    id: 'domain',
    title: 'Domain',
    groupBy: 'domain',
    metricLabel: '# of Answers',
    metric: { agg: 'count' },
    where: isNotNull(column('domain')),
  },
  {
    id: 'url',
    title: 'URL',
    groupBy: 'url',
    metricLabel: '# of Answers',
    metric: { agg: 'count' },
    where: isNotNull(column('url')),
  },
];

function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [expandedTableId, setExpandedTableId] = useState<SummaryTableId | null>(
    null,
  );
  // Which authoring view is active. Default 'classic' so the existing e2e
  // (dashboard + share-loop) sees the hardcoded controls unchanged. Both views
  // author the SAME page filterSet, so switching only re-renders the editor.
  const [filterView, setFilterView] = useState<FilterView>('classic');

  // Metric-threshold filter state lives at page level so it survives the
  // enlarge/return remounts of the summary tables — one per card, each
  // routing HAVING into its own card and a membership subquery to siblings.
  const metricFilters: Record<SummaryTableId, MetricThresholdFilterState> = {
    phrase: useMetricThresholdFilter({
      config: summaryTables[0]!,
      enabled: isReady,
    }),
    question: useMetricThresholdFilter({
      config: summaryTables[1]!,
      enabled: isReady,
    }),
    domain: useMetricThresholdFilter({
      config: summaryTables[2]!,
      enabled: isReady,
    }),
    url: useMetricThresholdFilter({
      config: summaryTables[3]!,
      enabled: isReady,
    }),
  };

  useEffect(() => {
    let cancelled = false;
    initPaaTable()
      .then(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const expandedTable = useMemo(
    () => summaryTables.find((table) => table.id === expandedTableId) ?? null,
    [expandedTableId],
  );

  if (error !== null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-500">
        <div className="text-lg font-bold">Initialization Failed</div>
        <p
          className="max-w-md rounded border border-red-100 bg-red-50 p-2 text-center text-sm"
          data-testid="load-error"
        >
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300"
        >
          Reload Page
        </button>
      </div>
    );
  }

  // Render optimistically: every client gates its queries on
  // `enabled={isReady}`, so the page shell paints while DuckDB loads.
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-slate-50/50 pb-10">
      <HeaderSection enabled={isReady} />

      <ActiveFilterBar />

      <div className="relative z-10 -mt-8 px-6">
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <FilterViewToggle view={filterView} onChange={setFilterView} />

          {filterView === 'classic' ? (
            // Classic view: the app's hardcoded top-bar controls, as-is.
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <div className="mr-2 self-center text-sm font-bold text-slate-700">
                FILTER BY:
              </div>
              <DomainFilter enabled={isReady} />
              <TextFilter
                label="Phrase"
                runtime="phrase"
                testId="filter-phrase"
              />
              <KeywordGroupFilter enabled={isReady} />
              <DateRangeFilter />
              <DeviceFilter enabled={isReady} />
              <TextFilter
                label="Question Contains"
                runtime="question"
                testId="filter-question"
              />
              <QuestionMinDomainsFilter />
            </div>
          ) : (
            // Builder view: the dynamic builder over the same page filterSet.
            <FilterBuilder />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 px-6 lg:grid-cols-2 xl:grid-cols-4">
        {summaryTables.map((config) => {
          if (config.id === expandedTableId) {
            return (
              <SummaryTablePlaceholder
                key={config.id}
                summaryId={config.id}
                title={config.title}
                onRestore={() => setExpandedTableId(null)}
              />
            );
          }
          return (
            <SummaryTable
              key={config.id}
              config={config}
              enabled={isReady}
              heightClassName="h-[700px]"
              headerControls={
                <MetricThresholdControls state={metricFilters[config.id]} />
              }
              promotionButton={
                <button
                  type="button"
                  className="h-7 rounded px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                  aria-label={`Enlarge ${config.title} table`}
                  onClick={() => setExpandedTableId(config.id)}
                >
                  ↗ Enlarge
                </button>
              }
            />
          );
        })}
      </div>

      {expandedTable !== null ? (
        <div className="px-6">
          <SummaryTable
            key={`${expandedTable.id}-expanded`}
            config={expandedTable}
            enabled={isReady}
            heightClassName="h-[820px]"
            promoted
            headerControls={
              <MetricThresholdControls
                state={metricFilters[expandedTable.id]}
              />
            }
            promotionButton={
              <button
                type="button"
                className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                aria-label={`Return ${expandedTable.title} table to grid`}
                onClick={() => setExpandedTableId(null)}
              >
                ↙ Return to grid
              </button>
            }
          />
        </div>
      ) : null}

      <div className="min-h-[500px] flex-1 px-6">
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/50 p-4 font-semibold text-slate-800">
            Detailed Breakdown
          </div>
          <div className="flex-1 overflow-auto p-0">
            <DetailTable enabled={isReady} />
          </div>
        </div>
      </div>
    </div>
  );
}

type FilterView = 'classic' | 'builder';

function FilterViewToggle(props: {
  view: FilterView;
  onChange: (next: FilterView) => void;
}) {
  const { view, onChange } = props;
  const buttonClass = (target: FilterView) =>
    `h-8 rounded px-3 text-xs font-semibold tracking-wide transition-colors ${
      view === target
        ? 'bg-white text-cyan-800 shadow-sm'
        : 'text-slate-500 hover:text-slate-700'
    }`;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        Filters
      </span>
      <div
        data-testid="filter-view-toggle"
        className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5"
      >
        <button
          type="button"
          data-testid="filter-view-classic"
          aria-pressed={view === 'classic'}
          className={buttonClass('classic')}
          onClick={() => onChange('classic')}
        >
          Classic
        </button>
        <button
          type="button"
          data-testid="filter-view-builder"
          aria-pressed={view === 'builder'}
          className={buttonClass('builder')}
          onClick={() => onChange('builder')}
        >
          Builder
        </button>
      </div>
    </div>
  );
}

function HeaderSection(props: { enabled: boolean }) {
  // One values client, four KPIs per round trip, filtered by everything on
  // the page.
  const kpis = useMosaicValues<{
    phrases: number;
    questions: number;
    days: number;
    devices: number;
  }>({
    query: ({ where }) =>
      Query.from(tableName)
        .select({
          phrases: count('phrase').distinct(),
          questions: count(sql`"related_phrase"."phrase"`).distinct(),
          days: count('requested').distinct(),
          devices: count('device').distinct(),
        })
        .where(where),
    filterBy: $page,
    enabled: props.enabled,
  });

  return (
    <div className="bg-[#0e7490] px-6 pt-8 pb-12 text-white">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-light tracking-wide">
            Nozzle PAA Report
          </h1>
          <p className="mt-1 text-sm text-cyan-100">
            SEO Intelligence Dashboard — Mosaic data clients
          </p>
        </div>
        <div className="flex flex-wrap gap-8 md:gap-12">
          <KpiCard
            label="# of Tracked Phrases"
            testId="kpi-phrases"
            value={kpis.values?.phrases}
          />
          <KpiCard
            label="# of Unique Questions"
            testId="kpi-questions"
            value={kpis.values?.questions}
          />
          <KpiCard
            label="# of Days"
            testId="kpi-days"
            value={kpis.values?.days}
          />
          <KpiCard
            label="# of Devices"
            testId="kpi-devices"
            value={kpis.values?.devices}
          />
        </div>
      </div>
    </div>
  );
}

function KpiCard(props: {
  label: string;
  testId: string;
  value: number | undefined;
}) {
  return (
    <div className="text-center md:text-right">
      <div className="mb-1 text-xs font-semibold tracking-wider text-cyan-200 uppercase">
        {props.label}
      </div>
      <div className="text-3xl font-bold" data-testid={props.testId}>
        {props.value === undefined ? '…' : Number(props.value).toLocaleString()}
      </div>
    </div>
  );
}

export default App;
