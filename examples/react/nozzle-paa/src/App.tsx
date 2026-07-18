/**
 * The People Also Ask dashboard on the data-client stack (issue #165): KPI
 * header, four cross-filtering group-by summary tables with row-select
 * publishing, in-widget selection chips, and per-card metric-threshold
 * (HAVING + membership) filters, the min-domains subquery filter, top-bar
 * facet/text/date inputs, an active-filter chip bar with global reset, a
 * sparkline column, and a detail table with bridged column filters — all
 * driven by a declared Selection topology (`topologyConfig` in page-context.ts,
 * resolved via `useTopology` + `MosaicTopologyProvider`), plus a "Domain
 * spotlight" quick-filter that publishes a FOREIGN clause direct to a
 * topology-owned Selection.
 */
import { useMemo, useState } from 'react';
import { Query, column, count, isNotNull, sql } from '@uwdata/mosaic-sql';
import {
  MosaicProvider,
  MosaicTopologyProvider,
  useMosaicValues,
} from '@nozzleio/react-mosaic';
import { ConnectorProvider, useConnector } from './connector';
import { useDataLoad } from './data-loader';
import { tableName } from './page-context';
import { usePageContexts, usePageTopology } from './topology';
import { ActiveFilterBar } from './components/active-filter-bar';
import { SpotlightFilter } from './components/spotlight-filter';
import { VolumeBrushPanel } from './components/volume-brush-panel';
import { DetailTable } from './components/detail-table';
import { FilterBuilder } from './components/filter-builder';
import {
  DateRangeFilter,
  DeviceFilter,
  DomainFilter,
  KeywordGroupFilter,
  QuestionMinDomainsFilter,
  TextFilter,
} from './components/question-filters';
import {
  MetricThresholdControls,
  useMetricThresholdFilter,
} from './components/metric-threshold-filter';
import {
  SummaryTable,
  SummaryTablePlaceholder,
} from './components/summary-table';
import type { DataClientStatus } from '@nozzleio/react-mosaic';
import type { DataLoadConfig } from './data-loader';
import type { MetricThresholdFilterState } from './components/metric-threshold-filter';
import type { SummaryTableConfig } from './components/summary-table';
import type { SummaryTableId } from './page-context';

// Declarative source config (recipe 2). The dataset is vendored under
// media/data and symlinked into this app's public/data, so it is served from
// the app's own origin — no network fetch, no CORS. The loader resolves the
// relative path to a fully-qualified URL for DuckDB-WASM.
const dataLoadConfig: DataLoadConfig = {
  [tableName]: { type: 'parquet', url: '/data/questions.parquet' },
};

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
  // Recipe 1: own the coordinator lifecycle. Everything below resolves this
  // explicit coordinator (via MosaicProvider) instead of Mosaic's global.
  return (
    <ConnectorProvider>
      <Bootstrap />
    </ConnectorProvider>
  );
}

/**
 * Bridges the connector (recipe 1) and the data loader (recipe 2) into the
 * app's single status gate, then provides the coordinator and topology to the
 * tree. The topology (and thus all Selection state) is keyed on the connection
 * identity, so recreating the connector resets it cleanly.
 */
function Bootstrap() {
  const { coordinator, connectionId } = useConnector();
  const load = useDataLoad(coordinator, dataLoadConfig);
  const status: BootstrapStatus =
    load.error !== null ? 'error' : load.done ? 'ready' : 'connecting';

  return (
    <MosaicProvider coordinator={coordinator}>
      {/* Key on the connection identity: recreating the connector remounts the
          whole topology subtree, so `usePageTopology` builds fresh Selections
          and no stale state survives against the new coordinator. */}
      <PageTopology key={connectionId} status={status} error={load.error} />
    </MosaicProvider>
  );
}

type BootstrapStatus = 'connecting' | 'error' | 'ready';

/**
 * Builds the ONE page topology and distributes it so every widget resolves its
 * selections by ref without prop-drilling. Lives inside the connection-keyed
 * boundary so the topology (and all Selection state) is torn down and rebuilt
 * with the connection.
 */
function PageTopology(props: { status: BootstrapStatus; error: Error | null }) {
  const topology = usePageTopology();
  return (
    <MosaicTopologyProvider topology={topology}>
      <Dashboard status={props.status} error={props.error} />
    </MosaicTopologyProvider>
  );
}

function Dashboard(props: { status: BootstrapStatus; error: Error | null }) {
  const { status, error } = props;
  const isReady = status === 'ready';
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

  const expandedTable = useMemo(
    () => summaryTables.find((table) => table.id === expandedTableId) ?? null,
    [expandedTableId],
  );

  if (status === 'error') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-500">
        <div className="text-lg font-bold">Initialization Failed</div>
        <p
          className="max-w-md rounded border border-red-100 bg-red-50 p-2 text-center text-sm"
          data-testid="load-error"
        >
          {error?.message ?? 'Unknown error'}
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
              <SpotlightFilter enabled={isReady} />
            </div>
          ) : (
            // Builder view: the dynamic builder over the same page filterSet.
            <FilterBuilder />
          )}
        </div>
      </div>

      <div className="px-6">
        <VolumeBrushPanel enabled={isReady} />
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
          <DetailTable enabled={isReady} />
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
  const { page } = usePageContexts();
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
    filterBy: page,
    enabled: props.enabled,
  });

  return (
    <div className="bg-[#0e7490] px-6 pt-8 pb-12 text-white">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-light tracking-wide">
            People Also Ask Report
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
            status={kpis.status}
          />
          <KpiCard
            label="# of Unique Questions"
            testId="kpi-questions"
            value={kpis.values?.questions}
            status={kpis.status}
          />
          <KpiCard
            label="# of Days"
            testId="kpi-days"
            value={kpis.values?.days}
            status={kpis.status}
          />
          <KpiCard
            label="# of Devices"
            testId="kpi-devices"
            value={kpis.values?.devices}
            status={kpis.status}
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
  // The shared values client's status ('pending' while a re-query is in
  // flight, 'success' once it settles). Surfaced as `data-status` so e2e can
  // gate a baseline capture on a *settled* KPI rather than a transient value
  // painted mid-requery — a burst-of-clauses interaction (the volume brush)
  // paints several intermediate counts before the final query lands.
  status?: DataClientStatus;
}) {
  return (
    <div className="text-center md:text-right">
      <div className="mb-1 text-xs font-semibold tracking-wider text-cyan-200 uppercase">
        {props.label}
      </div>
      <div
        className="text-3xl font-bold"
        data-testid={props.testId}
        data-status={props.status}
      >
        {props.value === undefined ? '…' : Number(props.value).toLocaleString()}
      </div>
    </div>
  );
}

export default App;
