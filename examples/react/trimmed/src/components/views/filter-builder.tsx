import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  DATE_RANGE_CONDITIONS,
  MULTISELECT_SCALAR_CONDITIONS,
  NUMBER_RANGE_CONDITIONS,
  SELECT_CONDITIONS,
  TEXT_CONDITIONS,
  useMosaicFilters,
  useMosaicReactTable,
} from '@nozzleio/mosaic-tanstack-react-table';
import {
  coerceDate,
  coerceNumber,
  createMosaicColumnHelper,
  createMosaicMapping,
} from '@nozzleio/mosaic-tanstack-react-table/helpers';
import {
  useCascadingContexts,
  useComposedSelection,
} from '@nozzleio/react-mosaic';

import type { ColumnDef } from '@tanstack/react-table';
import type {
  FilterBindingPersister,
  FilterDefinition,
  FilterRuntime,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection as MosaicSelection } from '@uwdata/mosaic-core';
import { ActiveFilterRow } from '@/components/filter-builder/active-filter-row';
import { AddFilterMenu } from '@/components/filter-builder/add-filter-menu';
import {
  addFilter,
  getAvailableFiltersForScope,
  removeFilter,
} from '@/components/filter-builder/builder-state';
import {
  createPageScopeUrlPersister,
  createWidgetScopeUrlBindingPersister,
  readPageScopeUrlFilterIds,
  readWidgetScopeUrlFilterIds,
  writePageScopeUrlFilterIds,
  writeWidgetScopeUrlFilterIds,
} from '@/components/filter-builder/url-persister';
import { RenderTable } from '@/components/render-table';
import { simpleDateFormatter } from '@/lib/utils';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes_filter_builder';
const DEFAULT_PAGE_ACTIVE_FILTER_IDS = ['name', 'sport'];
const DEFAULT_WIDGET_ACTIVE_FILTER_IDS = ['sex'];

interface AthleteRowData {
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
}

const athleteMapping = createMosaicMapping<AthleteRowData>({
  id: { sqlColumn: 'id', type: 'INTEGER', filterType: 'EQUALS' },
  name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  nationality: {
    sqlColumn: 'nationality',
    type: 'VARCHAR',
    filterType: 'EQUALS',
  },
  sex: { sqlColumn: 'sex', type: 'VARCHAR', filterType: 'EQUALS' },
  date_of_birth: {
    sqlColumn: 'date_of_birth',
    type: 'DATE',
    filterType: 'DATE_RANGE',
  },
  height: { sqlColumn: 'height', type: 'FLOAT', filterType: 'RANGE' },
  weight: { sqlColumn: 'weight', type: 'FLOAT', filterType: 'RANGE' },
  sport: { sqlColumn: 'sport', type: 'VARCHAR', filterType: 'EQUALS' },
  gold: { sqlColumn: 'gold', type: 'INTEGER', filterType: 'RANGE' },
  silver: { sqlColumn: 'silver', type: 'INTEGER', filterType: 'RANGE' },
  bronze: { sqlColumn: 'bronze', type: 'INTEGER', filterType: 'RANGE' },
});

const pageDefinitions: Array<FilterDefinition> = [
  {
    id: 'name',
    label: 'Athlete',
    column: 'name',
    valueKind: 'text',
    operators: [
      TEXT_CONDITIONS.CONTAINS,
      TEXT_CONDITIONS.EQUALS,
      TEXT_CONDITIONS.NOT_EQUALS,
      TEXT_CONDITIONS.IS_EMPTY,
      TEXT_CONDITIONS.IS_NOT_EMPTY,
      TEXT_CONDITIONS.STARTS_WITH,
      TEXT_CONDITIONS.ENDS_WITH,
    ],
    defaultOperator: TEXT_CONDITIONS.CONTAINS,
    dataType: 'string',
    description: 'Page-level text filter',
  },
  {
    id: 'sport',
    label: 'Sport',
    column: 'sport',
    valueKind: 'facet-single',
    operators: [
      SELECT_CONDITIONS.IS,
      SELECT_CONDITIONS.IS_NOT,
      SELECT_CONDITIONS.IS_EMPTY,
      SELECT_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: SELECT_CONDITIONS.IS,
    dataType: 'string',
    facet: {
      table: tableName,
      sortMode: 'count',
      limit: 25,
    },
  },
  {
    id: 'nationality',
    label: 'Nationality',
    column: 'nationality',
    valueKind: 'facet-multi',
    operators: [
      MULTISELECT_SCALAR_CONDITIONS.ANY_OF,
      MULTISELECT_SCALAR_CONDITIONS.NONE_OF,
      MULTISELECT_SCALAR_CONDITIONS.IS_EMPTY,
      MULTISELECT_SCALAR_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: MULTISELECT_SCALAR_CONDITIONS.ANY_OF,
    dataType: 'string',
    facet: {
      table: tableName,
      sortMode: 'count',
      limit: 30,
    },
  },
  {
    id: 'date_of_birth',
    label: 'Born',
    column: 'date_of_birth',
    valueKind: 'date-range',
    operators: [
      DATE_RANGE_CONDITIONS.BETWEEN,
      DATE_RANGE_CONDITIONS.BEFORE,
      DATE_RANGE_CONDITIONS.AFTER,
      DATE_RANGE_CONDITIONS.IS_EMPTY,
      DATE_RANGE_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: DATE_RANGE_CONDITIONS.BETWEEN,
    dataType: 'date',
  },
  {
    id: 'height',
    label: 'Height',
    column: 'height',
    valueKind: 'number-range',
    operators: [
      NUMBER_RANGE_CONDITIONS.BETWEEN,
      NUMBER_RANGE_CONDITIONS.AFTER,
      NUMBER_RANGE_CONDITIONS.IS_EMPTY,
      NUMBER_RANGE_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: NUMBER_RANGE_CONDITIONS.BETWEEN,
    dataType: 'number',
  },
];

const widgetDefinitions: Array<FilterDefinition> = [
  {
    id: 'sex',
    label: 'Gender',
    column: 'sex',
    valueKind: 'facet-single',
    operators: [
      SELECT_CONDITIONS.IS,
      SELECT_CONDITIONS.IS_NOT,
      SELECT_CONDITIONS.IS_EMPTY,
      SELECT_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: SELECT_CONDITIONS.IS,
    dataType: 'string',
    facet: {
      table: tableName,
      sortMode: 'count',
      limit: 10,
    },
  },
  {
    id: 'gold',
    label: 'Gold Medals',
    column: 'gold',
    valueKind: 'number-range',
    operators: [
      NUMBER_RANGE_CONDITIONS.BETWEEN,
      NUMBER_RANGE_CONDITIONS.AFTER,
      NUMBER_RANGE_CONDITIONS.IS_EMPTY,
      NUMBER_RANGE_CONDITIONS.IS_NOT_EMPTY,
    ],
    defaultOperator: NUMBER_RANGE_CONDITIONS.BETWEEN,
    dataType: 'number',
  },
];

export function FilterBuilderView() {
  const [isReady, setIsReady] = useState(false);
  const [pageActiveFilterIds, setPageActiveFilterIds] = useState(() =>
    readPageScopeUrlFilterIds(pageDefinitions, DEFAULT_PAGE_ACTIVE_FILTER_IDS),
  );
  const [widgetActiveFilterIds, setWidgetActiveFilterIds] = useState(() =>
    readWidgetScopeUrlFilterIds(
      widgetDefinitions,
      DEFAULT_WIDGET_ACTIVE_FILTER_IDS,
    ),
  );
  const [pageSearchTerm, setPageSearchTerm] = useState('');
  const [widgetSearchTerm, setWidgetSearchTerm] = useState('');
  const chartRef = useRef<HTMLDivElement | null>(null);
  const rosterColumns = useRosterColumns();
  const widgetColumns = useWidgetColumns();
  const pageScopePersister = useMemo(() => createPageScopeUrlPersister(), []);
  const widgetBindingPersister = useMemo(
    () => createWidgetScopeUrlBindingPersister(),
    [],
  );
  const page = useMosaicFilters({
    scopeId: 'page',
    definitions: pageDefinitions,
    persister: pageScopePersister,
  });
  const widget = useMosaicFilters({
    scopeId: 'widget:medal-table',
    definitions: widgetDefinitions,
  });
  const pageFacetContexts = useCascadingContexts(page.selections);
  const widgetFacetContexts = useCascadingContexts(widget.selections, [
    page.context,
  ]);
  const widgetContext = useComposedSelection([page.context, widget.context]);
  const pageAvailableDefinitions = useMemo(
    () =>
      getAvailableFiltersForScope(
        pageDefinitions,
        pageActiveFilterIds,
        pageSearchTerm,
      ),
    [pageActiveFilterIds, pageSearchTerm],
  );
  const widgetAvailableDefinitions = useMemo(
    () =>
      getAvailableFiltersForScope(
        widgetDefinitions,
        widgetActiveFilterIds,
        widgetSearchTerm,
      ),
    [widgetActiveFilterIds, widgetSearchTerm],
  );
  const pageActiveFilters = useMemo(
    () =>
      pageActiveFilterIds.reduce<Array<FilterRuntime>>((filters, filterId) => {
        const runtime = page.getFilter(filterId);
        if (!runtime) {
          return filters;
        }

        filters.push(runtime);
        return filters;
      }, []),
    [page, pageActiveFilterIds],
  );
  const widgetActiveFilters = useMemo(
    () =>
      widgetActiveFilterIds.reduce<Array<FilterRuntime>>(
        (filters, filterId) => {
          const runtime = widget.getFilter(filterId);
          if (!runtime) {
            return filters;
          }

          filters.push(runtime);
          return filters;
        },
        [],
      ),
    [widget, widgetActiveFilterIds],
  );

  useEffect(() => {
    writePageScopeUrlFilterIds(pageActiveFilterIds);
  }, [pageActiveFilterIds]);

  useEffect(() => {
    writeWidgetScopeUrlFilterIds(widgetActiveFilterIds);
  }, [widgetActiveFilterIds]);

  useEffect(() => {
    if (!chartRef.current || chartRef.current.hasChildNodes()) {
      return;
    }

    let active = true;

    async function setup() {
      await vg
        .coordinator()
        .exec([
          `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
        ]);

      if (!active) {
        return;
      }

      const plot = vg.plot(
        vg.dot(vg.from(tableName, { filterBy: page.context }), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          r: 3,
          opacity: 0.18,
        }),
        vg.regressionY(vg.from(tableName, { filterBy: page.context }), {
          x: 'weight',
          y: 'height',
          stroke: 'sex',
        }),
        vg.colorDomain(['female', 'male']),
      );

      chartRef.current?.replaceChildren(plot);
      setIsReady(true);
    }

    setup().catch((error: unknown) => {
      console.warn('FilterBuilderView setup failed:', error);
    });

    return () => {
      active = false;
    };
  }, [page.context]);

  return (
    <div className="grid gap-6">
      <section
        className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
        data-testid="page-filter-scope"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold">Page Filter Scope</h3>
            <p className="max-w-3xl text-sm text-slate-600">
              These controls write into the page scope. The scatter plot and the
              roster table both consume <code>page.context</code>.
            </p>
          </div>
          <AddFilterMenu
            scopeId="page"
            title="Page Filter Catalog"
            availableDefinitions={pageAvailableDefinitions}
            searchTerm={pageSearchTerm}
            onSearchTermChange={setPageSearchTerm}
            onAddFilter={(filterId) => {
              setPageActiveFilterIds((previousFilterIds) =>
                addFilter(previousFilterIds, filterId),
              );
            }}
          />
        </div>
        <DynamicFilterList
          emptyText="No page filters are active."
          filters={pageActiveFilters}
          facetContexts={pageFacetContexts}
          scopeLabel="page"
          scopeId="page"
          onRemoveFilter={(filterId) => {
            setPageActiveFilterIds((previousFilterIds) =>
              removeFilter(previousFilterIds, filterId),
            );
          }}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold">
              Chart Using `page.context`
            </h3>
            <p className="text-sm text-slate-600">
              Native inputs write into selections, and vgplot reads the derived
              page context through <code>filterBy</code>.
            </p>
          </div>
          {!isReady && (
            <div className="text-sm italic text-slate-500">Loading chart…</div>
          )}
          <div ref={chartRef} />
        </section>

        <AthleteTableCard
          cardId="page-roster"
          title="Roster Table"
          description="This table only consumes page filters."
          filterBy={page.context}
          columns={rosterColumns}
          debugName="FilterBuilderRosterTable"
        />
      </div>

      <section
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4"
        data-testid="widget-filter-scope"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold">Widget Filter Scope</h3>
            <p className="max-w-3xl text-sm text-slate-600">
              This widget adds a local filter section. The medal table reads the
              explicit intersection of <code>page.context</code> and{' '}
              <code>widget.context</code>.
            </p>
          </div>
          <AddFilterMenu
            scopeId="widget"
            title="Widget Filter Catalog"
            availableDefinitions={widgetAvailableDefinitions}
            searchTerm={widgetSearchTerm}
            onSearchTermChange={setWidgetSearchTerm}
            onAddFilter={(filterId) => {
              setWidgetActiveFilterIds((previousFilterIds) =>
                addFilter(previousFilterIds, filterId),
              );
            }}
          />
        </div>
        <DynamicFilterList
          bindingPersister={widgetBindingPersister}
          emptyText="No widget-local filters are active."
          filters={widgetActiveFilters}
          facetContexts={widgetFacetContexts}
          scopeLabel="widget"
          scopeId="widget"
          onRemoveFilter={(filterId) => {
            setWidgetActiveFilterIds((previousFilterIds) =>
              removeFilter(previousFilterIds, filterId),
            );
          }}
        />
        <AthleteTableCard
          cardId="widget-medals"
          title="Medal Widget"
          description="This table uses page filters plus widget-local filters."
          filterBy={widgetContext}
          columns={widgetColumns}
          debugName="FilterBuilderWidgetTable"
        />
      </section>
    </div>
  );
}

function DynamicFilterList({
  bindingPersister,
  emptyText,
  filters,
  facetContexts,
  scopeLabel,
  scopeId,
  onRemoveFilter,
}: {
  bindingPersister?: FilterBindingPersister;
  emptyText: string;
  filters: Array<FilterRuntime>;
  facetContexts: Record<string, MosaicSelection>;
  scopeLabel: string;
  scopeId: string;
  onRemoveFilter: (id: string) => void;
}) {
  if (filters.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {filters.map((filter) => (
        <ActiveFilterRow
          key={filter.definition.id}
          filter={filter}
          filterBy={facetContexts[filter.definition.id]}
          bindingPersister={bindingPersister}
          scopeId={scopeId}
          scopeLabel={scopeLabel}
          onRemoveFilter={onRemoveFilter}
        />
      ))}
    </div>
  );
}

function useRosterColumns() {
  const columnHelper = useMemo(
    () => createMosaicColumnHelper<AthleteRowData>(),
    [],
  );

  return useMemo<Array<ColumnDef<AthleteRowData, any>>>(
    () => [
      columnHelper.accessor('name', {
        header: 'Athlete',
      }),
      columnHelper.accessor('sport', {
        header: 'Sport',
      }),
      columnHelper.accessor('nationality', {
        header: 'Nationality',
      }),
      columnHelper.accessor('sex', {
        header: 'Gender',
      }),
      columnHelper.accessor('date_of_birth', {
        header: 'Born',
        cell: (info) => {
          const value = info.getValue();
          if (!(value instanceof Date)) {
            return '';
          }

          return simpleDateFormatter.format(value);
        },
      }),
    ],
    [columnHelper],
  );
}

function useWidgetColumns() {
  const columnHelper = useMemo(
    () => createMosaicColumnHelper<AthleteRowData>(),
    [],
  );

  return useMemo<Array<ColumnDef<AthleteRowData, any>>>(
    () => [
      columnHelper.accessor('name', {
        header: 'Athlete',
      }),
      columnHelper.accessor('sport', {
        header: 'Sport',
      }),
      columnHelper.accessor('sex', {
        header: 'Gender',
      }),
      columnHelper.accessor('gold', {
        header: 'Gold',
      }),
      columnHelper.accessor('silver', {
        header: 'Silver',
      }),
      columnHelper.accessor('bronze', {
        header: 'Bronze',
      }),
    ],
    [columnHelper],
  );
}

function AthleteTableCard({
  cardId,
  title,
  description,
  filterBy,
  columns,
  debugName,
}: {
  cardId: string;
  title: string;
  description: string;
  filterBy: MosaicSelection;
  columns: Array<ColumnDef<AthleteRowData, any>>;
  debugName: string;
}) {
  const { client, tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy,
    columns,
    mapping: athleteMapping,
    converter: (row) =>
      ({
        ...row,
        date_of_birth: coerceDate(row.date_of_birth),
        height: coerceNumber(row.height),
        weight: coerceNumber(row.weight),
        gold: coerceNumber(row.gold),
        silver: coerceNumber(row.silver),
        bronze: coerceNumber(row.bronze),
      }) as AthleteRowData,
    totalRowsMode: 'window',
    tableOptions: {
      enableColumnFilters: false,
      enableSorting: true,
      enableMultiSort: true,
      enableHiding: true,
    },
    __debugName: debugName,
  });
  const table = useReactTable(tableOptions);
  const subscribeToStore = React.useCallback(
    (onStoreChange: () => void) => {
      const subscription = client.store.subscribe(onStoreChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    [client.store],
  );
  const summaryText = React.useSyncExternalStore(
    subscribeToStore,
    () => {
      const firstRow = client.store.state.rows[0] as
        | Partial<AthleteRowData>
        | undefined;
      const firstRowName =
        typeof firstRow?.name === 'string' ? firstRow.name : 'none';

      return `Visible rows: ${client.store.state.rows.length} / Total rows: ${client.store.state.totalRows ?? 'unknown'} / First row: ${firstRowName}`;
    },
    () => {
      const firstRow = client.store.state.rows[0] as
        | Partial<AthleteRowData>
        | undefined;
      const firstRowName =
        typeof firstRow?.name === 'string' ? firstRow.name : 'none';

      return `Visible rows: ${client.store.state.rows.length} / Total rows: ${client.store.state.totalRows ?? 'unknown'} / First row: ${firstRowName}`;
    },
  );

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-slate-600">{description}</p>
        <p
          className="text-xs font-medium uppercase tracking-wide text-slate-500"
          data-testid={`${cardId}-summary`}
        >
          {summaryText}
        </p>
      </div>
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
