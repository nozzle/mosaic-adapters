import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  useFilterBinding,
  useFilterFacet,
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
  FilterDefinition,
  FilterRuntime,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection as MosaicSelection } from '@uwdata/mosaic-core';
import { RenderTable } from '@/components/render-table';
import { simpleDateFormatter } from '@/lib/utils';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes_filter_builder';

const OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  between: 'between',
  before: 'before',
  after: 'after',
};

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
    operators: ['contains'],
    defaultOperator: 'contains',
    dataType: 'string',
    description: 'Page-level text filter',
  },
  {
    id: 'sport',
    label: 'Sport',
    column: 'sport',
    valueKind: 'facet-single',
    operators: ['is'],
    defaultOperator: 'is',
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
    operators: ['is'],
    defaultOperator: 'is',
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
    operators: ['between', 'before', 'after'],
    defaultOperator: 'between',
    dataType: 'date',
  },
];

const widgetDefinitions: Array<FilterDefinition> = [
  {
    id: 'sex',
    label: 'Gender',
    column: 'sex',
    valueKind: 'facet-single',
    operators: ['is'],
    defaultOperator: 'is',
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
    operators: ['between', 'after'],
    defaultOperator: 'between',
    dataType: 'number',
  },
];

export function FilterBuilderView() {
  const [isReady, setIsReady] = useState(false);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const rosterColumns = useRosterColumns();
  const widgetColumns = useWidgetColumns();
  const page = useMosaicFilters({
    scopeId: 'page',
    definitions: pageDefinitions,
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
        vg.xyDomain(vg.Fixed),
        vg.colorDomain(vg.Fixed),
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
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid gap-1">
          <h3 className="text-lg font-semibold">Page Filter Scope</h3>
          <p className="text-sm text-slate-600">
            These controls write into the page scope. The scatter plot and the
            roster table both consume <code>page.context</code>.
          </p>
        </div>
        <FilterGrid
          filters={pageDefinitions.map(
            (definition) => page.getFilter(definition.id)!,
          )}
          facetContexts={pageFacetContexts}
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

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-1">
          <h3 className="text-lg font-semibold">Widget Filter Scope</h3>
          <p className="text-sm text-slate-600">
            This widget adds a local filter section. The medal table reads the
            explicit intersection of <code>page.context</code> and{' '}
            <code>widget.context</code>.
          </p>
        </div>
        <FilterGrid
          filters={widgetDefinitions.map(
            (definition) => widget.getFilter(definition.id)!,
          )}
          facetContexts={widgetFacetContexts}
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

function FilterGrid({
  filters,
  facetContexts,
}: {
  filters: Array<FilterRuntime>;
  facetContexts: Record<string, MosaicSelection>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {filters.map((filter) => (
        <NativeFilterCard
          key={filter.definition.id}
          filter={filter}
          filterBy={facetContexts[filter.definition.id]}
        />
      ))}
    </div>
  );
}

function NativeFilterCard({
  filter,
  filterBy,
}: {
  filter: FilterRuntime;
  filterBy?: MosaicSelection;
}) {
  const binding = useFilterBinding(filter);
  const facet = useFilterFacet({
    filter,
    filterBy,
    enabled:
      filter.definition.valueKind === 'facet-single' ||
      filter.definition.valueKind === 'facet-multi',
  });
  const showOperator =
    filter.definition.operators.length > 1 &&
    filter.definition.valueKind !== 'facet-single' &&
    filter.definition.valueKind !== 'facet-multi';
  const value = binding.value;
  const rangeValue = (Array.isArray(value) ? value : [null, null]) as [
    string | number | null,
    string | number | null,
  ];

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid gap-1">
        <label className="text-sm font-medium text-slate-900">
          {filter.definition.label}
        </label>
        {filter.definition.description && (
          <p className="text-xs text-slate-500">
            {filter.definition.description}
          </p>
        )}
      </div>

      {showOperator && (
        <select
          aria-label={`${filter.definition.label} operator`}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
          value={binding.operator ?? ''}
          onChange={(event) => binding.setOperator(event.target.value)}
        >
          {filter.definition.operators.map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABELS[operator] ?? operator}
            </option>
          ))}
        </select>
      )}

      {filter.definition.valueKind === 'text' && (
        <input
          type="text"
          aria-label={filter.definition.label}
          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          value={String(value ?? '')}
          placeholder="Contains…"
          onChange={(event) => binding.setValue(event.target.value)}
          onBlur={binding.apply}
        />
      )}

      {filter.definition.valueKind === 'facet-single' && (
        <select
          aria-label={filter.definition.label}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
          value={String(facet.selectedValues[0] ?? '')}
          onChange={(event) => facet.select(event.target.value || null)}
        >
          <option value="">All</option>
          {facet.options.map((option) => (
            <option key={String(option)} value={String(option ?? '')}>
              {String(option)}
            </option>
          ))}
        </select>
      )}

      {filter.definition.valueKind === 'facet-multi' && (
        <fieldset className="grid gap-2">
          <div className="max-h-40 overflow-auto rounded-md border border-slate-200 p-2">
            {facet.options.map((option) => {
              const checked = facet.selectedValues.some((selectedValue) =>
                Object.is(selectedValue, option),
              );

              return (
                <label
                  key={String(option)}
                  className="flex items-center gap-2 py-1 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    aria-label={`${filter.definition.label}: ${String(option)}`}
                    checked={checked}
                    onChange={() => facet.toggle(option)}
                  />
                  <span>{String(option)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {filter.definition.valueKind === 'date-range' && (
        <div className="grid gap-2">
          <input
            type="date"
            aria-label={`${filter.definition.label} start`}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
            value={String(rangeValue[0] ?? '')}
            onChange={(event) =>
              binding.setValue([event.target.value || null, rangeValue[1]])
            }
          />
          {binding.operator === 'between' && (
            <input
              type="date"
              aria-label={`${filter.definition.label} end`}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              value={String(rangeValue[1] ?? '')}
              onChange={(event) =>
                binding.setValue([rangeValue[0], event.target.value || null])
              }
            />
          )}
          <button
            type="button"
            className="h-9 rounded-md border border-slate-300 bg-slate-900 px-3 text-sm font-medium text-white"
            onClick={binding.apply}
          >
            Apply
          </button>
        </div>
      )}

      {filter.definition.valueKind === 'number-range' && (
        <div className="grid gap-2">
          <input
            type="number"
            aria-label={`${filter.definition.label} start`}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
            value={String(rangeValue[0] ?? '')}
            onChange={(event) =>
              binding.setValue([
                event.target.value === '' ? null : Number(event.target.value),
                rangeValue[1],
              ])
            }
          />
          {binding.operator === 'between' && (
            <input
              type="number"
              aria-label={`${filter.definition.label} end`}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              value={String(rangeValue[1] ?? '')}
              onChange={(event) =>
                binding.setValue([
                  rangeValue[0],
                  event.target.value === '' ? null : Number(event.target.value),
                ])
              }
            />
          )}
          <button
            type="button"
            className="h-9 rounded-md border border-slate-300 bg-slate-900 px-3 text-sm font-medium text-white"
            onClick={binding.apply}
          >
            Apply
          </button>
        </div>
      )}

      <button
        type="button"
        className="h-8 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700"
        onClick={binding.clear}
      >
        Clear
      </button>
    </div>
  );
}
