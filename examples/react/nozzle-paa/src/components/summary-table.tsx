/**
 * A grouped summary table: one rows client whose factory owns the GROUP BY
 * (so `filterStable: false` — the group domain changes under filtering),
 * with row-select publishing into the page {@link filterSet} (a `select:<card>`
 * points spec) consumed by every sibling widget.
 *
 * The set is the single source of truth for selection state: the in-widget
 * chips, the row checkmarks, and the highlight column all derive from the
 * `select:` spec value (read back from the store), so external removals — chip
 * bar, global reset — and the enlarge/collapse remount (stable spec id +
 * `#adoptFromSet`) need no extra wiring.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import { clausePoints } from '@uwdata/mosaic-core';
import {
  SqlIdentifier,
  createStructAccess,
  useFilterSetState,
  useMosaicRows,
  useMosaicSparkline,
} from '@nozzleio/react-mosaic';
import {
  $having,
  filterSet,
  sparklineContext,
  summaryFilterBy,
  tableName,
} from '../page-context';
import { Sparkline } from './sparkline';
import { WidgetSqlDetails } from './widget-sql-details';
import type { SparklineX, SparklineY } from '@nozzleio/react-mosaic';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { SummaryTableId } from '../page-context';

const PAGE_SIZE = 10;

export interface SummaryTableConfig {
  id: SummaryTableId;
  title: string;
  /** Group-by column (dotted paths are struct access). */
  groupBy: string;
  metricLabel: string;
  /** `count(*)` or `max(column)`. */
  metric: { agg: 'count' } | { agg: 'max'; column: string };
  /** Extra static WHERE (e.g. `domain IS NOT NULL`). */
  where?: ExprNode;
  /** Phrase-table sparkline column config. */
  sparkline?: { x: SparklineX; y: SparklineY };
}

const NO_SPARKLINE_X: SparklineX = { column: 'requested' };
const NO_SPARKLINE_Y: SparklineY = { agg: 'count' };

/** Chip labels for each card's row-selection spec (legacy registry parity). */
const SELECT_LABELS: Record<SummaryTableId, string> = {
  phrase: 'Selected Keyword',
  question: 'Selected Question',
  domain: 'Selected Domain',
  url: 'Selected URL',
};

interface GroupRow {
  key: string | number | null;
  metric: number | null;
  __is_highlighted: number;
}

/** The select spec id a summary card publishes into (page-context targets). */
function selectSpecId(id: SummaryTableId): string {
  return `select:${id}`;
}

/** Reads a summary card's selected scalar values from its `select:` spec. */
function useSelectedValues(id: SummaryTableId): Array<string | number | null> {
  const { specs } = useFilterSetState(filterSet);
  const value = specs.find((spec) => spec.id === selectSpecId(id))?.value;
  return useMemo(() => {
    if (Array.isArray(value)) {
      return value.filter((v) => v != null) as Array<string | number | null>;
    }
    return [];
  }, [value]);
}

export function SummaryTable(props: {
  config: SummaryTableConfig;
  enabled: boolean;
  heightClassName: string;
  promoted?: boolean;
  headerControls?: React.ReactNode;
  promotionButton?: React.ReactNode;
}) {
  const { config, enabled } = props;
  const [pageIndex, setPageIndex] = useState(0);

  // The card's own selected values, read back from its `select:` spec — chips,
  // checkmarks, and the highlight column all derive from this.
  const selectedValues = useSelectedValues(config.id);

  const rows = useMosaicRows<GroupRow>({
    query: ({ where, having }) => {
      const groupKey = createStructAccess(SqlIdentifier.from(config.groupBy));

      // Highlight column: rows matching the card's own selected values keep 1,
      // everything else drops to 0 and dims. Built from the selected values
      // directly (the clause is self-excluded from this card's own context).
      const highlightPredicate =
        selectedValues.length > 0
          ? clausePoints(
              [groupKey],
              selectedValues.map((value) => [value]),
              { source: {} },
            ).predicate
          : null;
      const highlight = highlightPredicate
        ? mSql.max(mSql.sql`CASE WHEN ${highlightPredicate} THEN 1 ELSE 0 END`)
        : mSql.literal(1);

      const query = mSql.Query.from(tableName)
        .select({
          key: groupKey,
          metric:
            config.metric.agg === 'count'
              ? mSql.count()
              : mSql.max(config.metric.column),
          __is_highlighted: highlight,
        })
        .groupby(groupKey)
        .where(where)
        .having(having);
      if (config.where !== undefined) {
        query.where(config.where);
      }
      return query;
    },
    filterBy: summaryFilterBy[config.id],
    // The card's own metric-threshold filter routes HAVING here; siblings
    // receive its membership subquery through their contexts instead.
    havingBy: $having[config.id],
    // The factory GROUP BYs a key whose domain changes under filtering, so
    // Mosaic's pre-aggregation assumptions do not hold.
    filterStable: false,
    rowCount: 'window',
    coerce: { metric: 'number', __is_highlighted: 'number' },
    inputs: {
      orderBy: [
        { column: 'metric', desc: true },
        // Deterministic tie-break: 'gaz stove' and 'gasoline stove' share
        // the top search volume.
        { column: 'key' },
      ],
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    },
    publish: {
      select: {
        into: filterSet,
        id: selectSpecId(config.id),
        label: SELECT_LABELS[config.id],
        columns: ['key'],
        fields: [config.groupBy],
      },
    },
    enabled,
  });
  const { client } = rows;

  // The card's own selection clause is self-excluded from its own context, so a
  // publish never re-queries this client natively — refetch the highlight
  // column when the selected values actually change.
  const lastSelectedRef = useRef(selectedValues);
  useEffect(() => {
    if (lastSelectedRef.current === selectedValues) {
      return;
    }
    lastSelectedRef.current = selectedValues;
    void client.refetch();
  }, [selectedValues, client]);

  // Clamp the page when a narrowed context shrinks the group count below
  // the current offset.
  useEffect(() => {
    if (rows.totalRows === undefined) {
      return;
    }
    const pageCount = Math.ceil(rows.totalRows / PAGE_SIZE);
    if (pageIndex > 0 && pageIndex >= pageCount) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [rows.totalRows, pageIndex]);

  // One batched sparkline client serves every cell on the visible page.
  const sparklines = useMosaicSparkline({
    from: tableName,
    key: config.groupBy,
    x: config.sparkline?.x ?? NO_SPARKLINE_X,
    y: config.sparkline?.y ?? NO_SPARKLINE_Y,
    filterBy: sparklineContext,
    inputs: {
      keys: config.sparkline
        ? rows.rows.map((row) => row.key).filter((key) => key != null)
        : [],
    },
    enabled: enabled && config.sparkline !== undefined,
  });

  const publishValues = (values: Array<string | number | null>) => {
    client.selectRows(
      values.map((value) => ({
        key: value,
        metric: null,
        __is_highlighted: 1,
      })),
    );
  };

  const toggleRow = (row: GroupRow) => {
    const isSelected = selectedValues.some((value) =>
      Object.is(value, row.key),
    );
    const next = isSelected
      ? selectedValues.filter((value) => !Object.is(value, row.key))
      : [...selectedValues, row.key];
    publishValues(next);
  };

  const pageCount =
    rows.totalRows === undefined
      ? null
      : Math.max(1, Math.ceil(rows.totalRows / PAGE_SIZE));

  return (
    <div
      data-testid={`summary-table-${config.id}${props.promoted ? '-expanded' : ''}`}
      className={`flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${props.heightClassName}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-sm font-bold tracking-wide text-slate-700 uppercase">
          {config.title}
        </div>
        <div className="flex items-center gap-2">
          {props.promoted ? (
            <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-semibold tracking-wide text-cyan-900 uppercase">
              Expanded view
            </span>
          ) : null}
          {props.promotionButton}
        </div>
      </div>

      {props.headerControls !== undefined ? (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-amber-50/60 px-4 py-2">
          {props.headerControls}
        </div>
      ) : null}

      {selectedValues.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-blue-50/60 px-4 py-3">
          <div className="text-[11px] font-semibold tracking-wide text-blue-900 uppercase">
            Selected ({selectedValues.length})
          </div>
          {selectedValues.map((value) => (
            <div
              key={String(value)}
              className="flex items-center gap-1 rounded-full border border-blue-200 bg-white py-1 pr-1 pl-2 text-xs text-blue-900 shadow-sm"
            >
              <span className="max-w-[180px] truncate" title={String(value)}>
                {String(value)}
              </span>
              <button
                type="button"
                className="h-5 w-5 rounded-full text-blue-700 hover:bg-blue-100"
                aria-label={`Remove ${config.title} selection ${String(value)}`}
                onClick={() =>
                  publishValues(
                    selectedValues.filter(
                      (candidate) => !Object.is(candidate, value),
                    ),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            className="h-6 rounded px-2 text-xs text-blue-900 hover:bg-blue-100"
            aria-label={`Clear ${config.title} selections`}
            onClick={() => publishValues([])}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-2">
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5">{config.title}</th>
              <th className="w-[105px] px-2 py-1.5">{config.metricLabel}</th>
              {config.sparkline ? (
                <th className="w-[120px] px-2 py-1.5">Trend</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((row) => {
              const isSelected = selectedValues.some((value) =>
                Object.is(value, row.key),
              );
              const dimmed =
                selectedValues.length > 0 && row.__is_highlighted === 0;
              return (
                <tr
                  key={String(row.key)}
                  onClick={() => toggleRow(row)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    dimmed ? 'opacity-30' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      readOnly
                      checked={isSelected}
                      className="size-4 cursor-pointer"
                    />
                  </td>
                  <td
                    className="truncate px-2 py-1.5"
                    title={String(row.key ?? '')}
                  >
                    {row.key === null ? '' : String(row.key)}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.metric?.toLocaleString() ?? ''}
                  </td>
                  {config.sparkline ? (
                    <td className="px-2 py-1.5">
                      {sparklines.status === 'pending' &&
                      !sparklines.series.has(row.key) ? (
                        <div className="h-7 w-[100px] animate-pulse rounded bg-slate-100" />
                      ) : (
                        <Sparkline
                          points={sparklines.series.get(row.key) ?? []}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {rows.rows.length === 0 && rows.status === 'success' ? (
              <tr>
                <td
                  colSpan={config.sparkline ? 4 : 3}
                  className="px-2 py-6 text-center text-sm text-slate-400"
                >
                  No results.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
        <button
          type="button"
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          disabled={pageIndex === 0}
          aria-label={`Previous ${config.title} page`}
          onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          disabled={pageCount !== null && pageIndex + 1 >= pageCount}
          aria-label={`Next ${config.title} page`}
          onClick={() => setPageIndex((index) => index + 1)}
        >
          Next
        </button>
        <span>
          Page {pageIndex + 1}
          {pageCount === null ? '' : ` of ${pageCount}`}
        </span>
        <span className="flex-1 text-right">
          {rows.totalRows === undefined
            ? '…'
            : `${rows.totalRows.toLocaleString()} groups`}
        </span>
      </div>

      <WidgetSqlDetails store={client.store} />
    </div>
  );
}

export function SummaryTablePlaceholder(props: {
  summaryId: SummaryTableId;
  title: string;
  onRestore: () => void;
}) {
  return (
    <div
      data-testid={`summary-table-${props.summaryId}-placeholder`}
      className="flex h-[700px] flex-col justify-between rounded-lg border border-dashed border-slate-300 bg-slate-100/70 p-6"
    >
      <div className="space-y-3">
        <div className="text-sm font-bold tracking-wide text-slate-700 uppercase">
          {props.title}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white/90 p-4">
          <div className="text-sm font-semibold text-slate-800">
            This table is enlarged below
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Row selections live in the page-level Selection topology, so they
            survive the move between regions of the page.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          aria-label={`Return ${props.title} table to grid`}
          onClick={props.onRestore}
        >
          ↙ Return to grid
        </button>
      </div>
    </div>
  );
}
