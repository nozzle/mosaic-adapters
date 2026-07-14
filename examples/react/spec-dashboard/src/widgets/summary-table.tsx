/**
 * A grouped summary table driven by the spec: one rows client whose compiled
 * raw-template query owns the GROUP BY (so `filterStable: false` — the group
 * domain changes under filtering), with row-select publishing into the page
 * FilterSet (a `select:<card>` points spec) consumed by every sibling widget.
 *
 * The FilterSet is the single source of truth for selection state: the in-widget
 * chips, the row checkmarks, and the highlight/dim all derive from the published
 * spec's value read back from the store — so external removals (chip bar, global
 * reset) and the enlarge/return swap (stable spec id, the set retains the spec
 * across the client remount) need no extra wiring. Highlight is computed
 * client-side from the selected values (no `__is_highlighted` SQL column, hence
 * no compiler surgery).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useFilterSetState,
  useMosaicRows,
  useMosaicSparkline,
} from '@nozzleio/react-mosaic';
import { compileQuery } from '../spec/query-compiler';
import { compileExclude } from '../spec/exclude';
import { resolveSelection } from '../spec/topology';
import { usePopoverDismiss } from '../chrome/use-popover-dismiss';
import { Sparkline } from './sparkline';
import { WidgetSqlPopover } from './widget-sql-details';
import type { ReactElement } from 'react';
import type { FilterSet, RowsInputs } from '@nozzleio/react-mosaic';
import type {
  MetricThresholdSpec,
  SelectionTableWidgetSpec,
} from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';

const PAGE_SIZE = 10;

/** The grouped row shape every summary query returns (`key`, `metric` aliases). */
interface GroupRow {
  key: string | number | null;
  metric: number | null;
}

/** Reads a card's selected scalar values back from its `select:` spec. */
function useSelectedValues(
  filterSet: FilterSet,
  specId: string,
): Array<string | number | null> {
  const { specs } = useFilterSetState(filterSet);
  const value = specs.find((spec) => spec.id === specId)?.value;
  return useMemo(() => {
    if (Array.isArray(value)) {
      return value.filter((v) => v != null) as Array<string | number | null>;
    }
    return [];
  }, [value]);
}

// ── Metric-threshold header control ──────────────────────────────────────────

type MetricComparison = 'gt' | 'lt';

const OP_SYMBOL: Record<MetricComparison, string> = { gt: '>', lt: '<' };

/** Compact, lowercased abbreviation for the header badge (e.g. `50k`). */
function formatThresholdBadge(value: number): string {
  return value.toLocaleString('en-US', { notation: 'compact' }).toLowerCase();
}

interface MetricThresholdState {
  /** Whether a threshold spec is currently committed to the page set. */
  applied: boolean;
  /** Draft operator (only committed on `apply`). */
  comparison: MetricComparison;
  /** Draft value (only committed on `apply`). */
  value: number | null;
  setComparison: (next: MetricComparison) => void;
  setValue: (next: number | null) => void;
  /** Publish the current draft as the `metric:<card>` spec. */
  apply: () => void;
  /** Remove the committed spec and reset the draft value. */
  clear: () => void;
}

/**
 * The card's metric-threshold filter, one `metric:<card>` spec on the page set,
 * resolved by the custom `metric-threshold` kind into a HAVING (own card) + a
 * membership subquery (siblings). Applied state derives from the spec's presence
 * in the store, so chip removal / reset unchecks it for free.
 *
 * Publishing is EXPLICIT: `setComparison`/`setValue` only touch the local draft,
 * and only `apply`/`clear` mutate the page set — so editing the value no longer
 * re-emits the HAVING + membership subquery page-wide on every keystroke.
 */
function useMetricThreshold(options: {
  filterSet: FilterSet;
  config: MetricThresholdSpec | undefined;
}): MetricThresholdState {
  const { filterSet, config } = options;
  const specId = config?.spec_id;
  const { specs } = useFilterSetState(filterSet);
  const spec =
    specId === undefined ? undefined : specs.find((s) => s.id === specId);
  const applied = spec !== undefined;

  const [comparison, setComparison] = useState<MetricComparison>('gt');
  const [value, setValue] = useState<number | null>(null);

  // Reflect the committed spec into the drafts (hydration, external edits) during
  // render, whenever the committed spec identity changes. Reflecting here rather
  // than in an effect avoids a cascading post-commit render; the guard makes it
  // run once per committed-spec change.
  const [reflectedSpec, setReflectedSpec] = useState(spec);
  if (spec !== reflectedSpec) {
    setReflectedSpec(spec);
    if (spec !== undefined) {
      if (spec.operator === 'gt' || spec.operator === 'lt') {
        setComparison(spec.operator);
      }
      if (typeof spec.value === 'number') {
        setValue(spec.value);
      }
    }
  }

  const commit = (
    nextComparison: MetricComparison,
    nextValue: number | null,
  ): void => {
    if (config === undefined) {
      return;
    }
    const active =
      nextValue !== null && Number.isFinite(nextValue) && nextValue >= 0;
    if (!active) {
      filterSet.remove(config.spec_id);
      return;
    }
    filterSet.set({
      id: config.spec_id,
      column: config.group_by,
      kind: config.kind,
      operator: nextComparison,
      value: nextValue,
      label: config.label,
    });
  };

  return {
    applied,
    comparison,
    value,
    setComparison,
    setValue,
    apply: () => commit(comparison, value),
    clear: () => {
      setValue(null);
      if (config !== undefined) {
        filterSet.remove(config.spec_id);
      }
    },
  };
}

/**
 * The metric-column-header threshold control: a compact funnel trigger (muted
 * when inactive, `gf-blue` + a value badge when applied) that opens a native
 * Popover-API panel with an operator select, a number input, and explicit
 * Apply / Clear buttons.
 *
 * The panel is an absolutely-positioned element inside the trigger's
 * `relative` wrapper — the same in-flow pattern as the filter builder's editor
 * popovers — so it stays anchored through page and container scroll for free.
 * It is right-aligned to the trigger (the metric column hugs the card's right
 * edge) and stays mounted, hidden with `display:none`, while closed;
 * {@link usePopoverDismiss} closes it on an outside mousedown or Escape.
 */
function MetricThresholdControl(props: {
  id: string;
  label: string;
  metricLabel: string;
  state: MetricThresholdState;
}): ReactElement {
  const { id, label, metricLabel, state } = props;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const opRef = useRef<HTMLSelectElement>(null);
  const close = useCallback((): void => {
    setOpen(false);
  }, []);
  usePopoverDismiss(rootRef, open, close);

  // Land focus on the first field once the panel is visible (it is
  // `display:none` until the open state applies, so focus post-render).
  useEffect(() => {
    if (open) {
      opRef.current?.focus();
    }
  }, [open]);

  const badge =
    state.applied && state.value !== null
      ? `${OP_SYMBOL[state.comparison]} ${formatThresholdBadge(state.value)}`
      : null;
  const ariaLabel =
    state.applied && state.value !== null
      ? `${metricLabel} threshold filter, active ${OP_SYMBOL[state.comparison]} ${state.value.toLocaleString('en-US')}`
      : `${metricLabel} threshold filter, inactive`;

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        data-testid={`metric-filter-${id}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-5 items-center gap-1 rounded-gf border px-1 text-[10px] font-medium normal-case transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue ${
          state.applied
            ? 'border-gf-blue/40 bg-gf-blue/10 text-gf-blue'
            : 'border-transparent text-muted hover:border-line hover:text-ink'
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3 shrink-0"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M1.5 2.5h13l-5 6v4l-3 1.5V8.5l-5-6Z" />
        </svg>
        {badge !== null ? (
          <span className="tabular-nums whitespace-nowrap">{badge}</span>
        ) : null}
      </button>
      {/* Stays mounted while closed (`hidden`) so the draft operator/value
          survive an open/close. z-30 clears the sticky thead (z-10). */}
      <div
        role="dialog"
        aria-label={`${label} threshold filter`}
        data-testid={`metric-filter-${id}-popover`}
        className={`absolute top-full right-0 z-30 mt-1 w-[216px] rounded-gf border border-line bg-panel p-3 text-ink shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        <div className="flex flex-col gap-2 text-left normal-case">
          <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            {label}
          </div>
          <div className="flex items-center gap-2">
            <select
              ref={opRef}
              data-testid={`metric-filter-${id}-op`}
              aria-label={`${label} comparison`}
              className="h-7 rounded-gf border border-line bg-field px-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
              value={state.comparison}
              onChange={(event) =>
                state.setComparison(event.target.value as MetricComparison)
              }
            >
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
            </select>
            <input
              data-testid={`metric-filter-${id}-value`}
              aria-label={`${label} threshold`}
              type="number"
              min={0}
              placeholder="N"
              className="h-7 min-w-0 flex-1 rounded-gf border border-line bg-field px-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
              value={state.value ?? ''}
              onChange={(event) => {
                const raw = event.target.value;
                state.setValue(raw === '' ? null : Number(raw));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  state.apply();
                  close();
                }
              }}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid={`metric-filter-${id}-clear`}
              className="h-7 rounded-gf px-2 text-xs text-muted hover:text-gf-red focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
              onClick={() => {
                state.clear();
                close();
              }}
            >
              Clear
            </button>
            <button
              type="button"
              data-testid={`metric-filter-${id}-apply`}
              className="h-7 rounded-gf bg-gf-blue px-3 text-xs font-medium text-white hover:bg-gf-blue-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
              onClick={() => {
                state.apply();
                close();
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The registry entry: delegates to placeholder or the data-bound body ──────

export function SelectionTableWidget({
  widget,
  context,
  mode,
}: WidgetComponentProps): ReactElement | null {
  if (widget.renderer !== 'selection-table') {
    return null;
  }
  if (mode === 'placeholder') {
    return (
      <SummaryPlaceholder
        id={widget.id}
        title={widget.title}
        onRestore={context.onRestore}
      />
    );
  }
  return (
    <SummaryTableBody
      widget={widget}
      context={context}
      promoted={mode === 'promoted'}
    />
  );
}

function SummaryTableBody(props: {
  widget: SelectionTableWidgetSpec;
  context: WidgetContext;
  promoted: boolean;
}): ReactElement {
  const { widget, context, promoted } = props;
  const { topology, filterSet, enabled } = context;
  const [pageIndex, setPageIndex] = useState(0);

  const filterBy = resolveSelection(topology, widget.filter_by);
  const havingBy = resolveSelection(topology, widget.having_by);
  const query = useMemo(
    () => compileQuery<RowsInputs>(widget.query),
    [widget.query],
  );
  // `exclude` (see spec/exclude.ts): `'all'` drops BOTH the WHERE (`filter_by`)
  // and HAVING (`having_by`) selections; a list yields a stable `skipSources`
  // the core applies to both automatically.
  const exclude = useMemo(
    () => compileExclude(widget.exclude),
    [widget.exclude],
  );
  const rowsFilterBy = exclude.omitFilterBy ? undefined : filterBy;
  const rowsHavingBy = exclude.omitFilterBy ? undefined : havingBy;

  const metric = useMetricThreshold({
    filterSet,
    config: widget.metric_threshold,
  });

  const selectedValues = useSelectedValues(filterSet, widget.publish.spec_id);

  const rows = useMosaicRows<GroupRow>({
    query,
    filterBy: rowsFilterBy,
    havingBy: rowsHavingBy,
    ...(exclude.skipSources !== undefined
      ? { skipSources: exclude.skipSources }
      : {}),
    // The factory GROUP BYs a key whose domain changes under filtering, so the
    // pre-aggregation assumptions do not hold.
    filterStable: false,
    rowCount: 'window',
    coerce: { metric: 'number' },
    inputs: {
      orderBy: [
        { column: 'metric', desc: true },
        // Deterministic tie-break for equal metrics.
        { column: 'key' },
      ],
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    },
    publish: {
      select: {
        into: filterSet,
        id: widget.publish.spec_id,
        label: widget.publish.label,
        columns: widget.publish.columns as Array<
          Extract<keyof GroupRow, string>
        >,
        fields: widget.publish.fields,
      },
    },
    enabled,
  });
  const { client } = rows;

  // Enlarge/return (and StrictMode's throwaway mount) unmounts this card and
  // mounts a fresh instance whose rows client re-adopts the surviving
  // `select:<card>` spec, re-keying its clause for crossfilter self-exclusion.
  // The library's adopt lifecycle re-queries the client once that self-exclusion
  // is re-keyed, so the card is never filtered by its own selection.

  // Clamp the page when a narrowed context shrinks the group count. Adjusted
  // during render (not in an effect): the guard shrinks pageIndex only when it
  // is out of range, so there is no re-render loop, and the clamped value feeds
  // the query on the same pass rather than after a throwaway commit.
  if (rows.totalRows !== undefined) {
    const pageCount = Math.ceil(rows.totalRows / PAGE_SIZE);
    if (pageIndex > 0 && pageIndex >= pageCount) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }

  // Warm the coordinator's query cache for the next page once the current
  // page has loaded successfully, so a forward page turn resolves from
  // cache instead of a fresh round trip. Guarded to only fire when a next
  // page plausibly exists (totalRows known and the next offset is still
  // in range); `client.prefetch` only reads current context and issues a
  // low-priority cached query — it never patches this client's store, so
  // this effect cannot re-trigger itself.
  useEffect(() => {
    if (!enabled || rows.status !== 'success' || rows.totalRows === undefined) {
      return;
    }
    const nextOffset = pageIndex * PAGE_SIZE + PAGE_SIZE;
    if (nextOffset >= rows.totalRows) {
      return;
    }
    client.prefetch({ offset: nextOffset });
  }, [enabled, rows.status, rows.totalRows, pageIndex, client]);

  // One batched sparkline client serves every cell on the visible page. Its
  // source is EXPLICIT (`table` + `key`) in the spec — no FROM-regex derivation.
  const sparkline = widget.sparkline;
  const sparklineKey =
    sparkline?.key ?? widget.publish.fields[0] ?? widget.publish.columns[0]!;
  const sparklines = useMosaicSparkline({
    from: sparkline?.table ?? 'unused',
    key: sparklineKey,
    x: sparkline?.x ?? { column: sparklineKey },
    y: sparkline?.y ?? { agg: 'count' },
    filterBy: rowsFilterBy,
    ...(exclude.skipSources !== undefined
      ? { skipSources: exclude.skipSources }
      : {}),
    inputs: {
      keys: sparkline
        ? rows.rows.map((row) => row.key).filter((key) => key != null)
        : [],
    },
    enabled: enabled && sparkline !== undefined,
  });

  const publishValues = (values: Array<string | number | null>) => {
    client.selectRows(values.map((value) => ({ key: value, metric: null })));
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

  const goToFirstPage = () => {
    setPageIndex(0);
  };

  const goToLastPage = () => {
    if (pageCount === null) {
      return;
    }
    setPageIndex(pageCount - 1);
  };

  const hasSparkline = widget.sparkline !== undefined;
  const columnCount = hasSparkline ? 4 : 3;
  const heightClass = promoted ? 'h-[640px]' : 'h-[460px]';

  return (
    <div
      data-testid={`summary-table-${widget.id}`}
      data-mode={promoted ? 'promoted' : 'default'}
      className={`flex flex-col overflow-hidden rounded-gf border border-line bg-panel transition-colors hover:border-line-strong ${heightClass}`}
    >
      <div className="relative flex h-[30px] shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <div className="truncate text-xs font-medium text-ink">
          {widget.title}
        </div>
        <div className="flex items-center gap-2">
          {promoted ? (
            <span className="rounded-gf bg-gf-blue/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-gf-blue uppercase">
              Expanded
            </span>
          ) : null}
          <WidgetSqlPopover store={client.store} label={widget.title} />
          {widget.expandable ? (
            <button
              type="button"
              className="flex h-6 items-center rounded-gf border border-line bg-panel-header px-2 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
              aria-label={
                promoted
                  ? `Return ${widget.title} table to grid`
                  : `Enlarge ${widget.title} table`
              }
              data-testid={`summary-table-${widget.id}-toggle`}
              onClick={() =>
                promoted ? context.onRestore() : context.onExpand(widget.id)
              }
            >
              {promoted ? '↙ Return' : '↗ Enlarge'}
            </button>
          ) : null}
        </div>
      </div>

      {selectedValues.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-gf-blue/5 px-3 py-2">
          <div className="text-[11px] font-semibold tracking-wide text-gf-blue uppercase">
            Selected ({selectedValues.length})
          </div>
          {selectedValues.map((value) => (
            <div
              key={String(value)}
              className="flex items-center gap-1 rounded-gf border border-gf-blue/40 bg-gf-blue/10 py-0.5 pr-1 pl-2 text-xs text-gf-blue"
            >
              <span className="max-w-[180px] truncate" title={String(value)}>
                {String(value)}
              </span>
              <button
                type="button"
                className="flex h-4 w-4 items-center justify-center rounded-gf text-gf-blue hover:bg-gf-blue/20"
                aria-label={`Remove ${widget.title} selection ${String(value)}`}
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
            className="h-6 rounded-gf px-2 text-xs text-muted hover:text-gf-red"
            aria-label={`Clear ${widget.title} selections`}
            onClick={() => publishValues([])}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <table className="w-full table-fixed text-xs">
          <thead className="sticky top-0 z-10 bg-panel-header text-left text-[11px] tracking-wide text-muted uppercase">
            <tr className="border-b border-line">
              <th className="w-8 px-3 py-1.5"></th>
              <th className="px-3 py-1.5 font-medium">{widget.title}</th>
              <th className="w-[176px] px-3 py-1.5 text-right font-medium">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="truncate">{widget.metric_label}</span>
                  {widget.metric_threshold !== undefined ? (
                    <MetricThresholdControl
                      id={widget.id}
                      label={widget.metric_threshold.label}
                      metricLabel={widget.metric_label}
                      state={metric}
                    />
                  ) : null}
                </div>
              </th>
              {hasSparkline ? (
                <th className="w-[120px] px-3 py-1.5 font-medium">Trend</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((row) => {
              const isSelected = selectedValues.some((value) =>
                Object.is(value, row.key),
              );
              const dimmed = selectedValues.length > 0 && !isSelected;
              return (
                <tr
                  key={String(row.key)}
                  onClick={() => toggleRow(row)}
                  className={`h-8 cursor-pointer border-b border-line hover:bg-hover ${
                    isSelected ? 'bg-gf-blue/8' : ''
                  } ${dimmed ? 'opacity-30' : ''}`}
                >
                  <td className="px-3 text-center">
                    <input
                      type="checkbox"
                      readOnly
                      checked={isSelected}
                      className="size-3.5 cursor-pointer accent-gf-blue"
                    />
                  </td>
                  <td
                    className="truncate px-3 text-ink"
                    title={String(row.key ?? '')}
                  >
                    {row.key === null ? '' : String(row.key)}
                  </td>
                  <td className="px-3 text-right tabular-nums text-muted">
                    {row.metric?.toLocaleString() ?? ''}
                  </td>
                  {hasSparkline ? (
                    <td className="px-3">
                      {sparklines.status === 'pending' &&
                      !sparklines.series.has(row.key) ? (
                        <div className="h-7 w-[100px] animate-pulse rounded-gf bg-hover" />
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
                  colSpan={columnCount}
                  className="px-3 py-6 text-center text-xs text-faint"
                >
                  No results.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5 text-[11px] text-muted">
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          disabled={pageIndex === 0}
          aria-label={`First ${widget.title} page`}
          onClick={goToFirstPage}
        >
          «
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          disabled={pageIndex === 0}
          aria-label={`Previous ${widget.title} page`}
          onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          disabled={pageCount !== null && pageIndex + 1 >= pageCount}
          aria-label={`Next ${widget.title} page`}
          onClick={() => setPageIndex((index) => index + 1)}
        >
          Next
        </button>
        <button
          type="button"
          className="rounded-gf border border-line px-2 py-0.5 hover:border-line-strong disabled:opacity-40"
          disabled={pageCount === null || pageIndex + 1 >= pageCount}
          aria-label={`Last ${widget.title} page`}
          onClick={goToLastPage}
        >
          »
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
    </div>
  );
}

function SummaryPlaceholder(props: {
  id: string;
  title: string;
  onRestore: () => void;
}): ReactElement {
  return (
    <div
      data-testid={`summary-table-${props.id}-placeholder`}
      className="flex h-[460px] flex-col justify-between rounded-gf border border-dashed border-line-strong bg-panel p-6"
    >
      <div className="space-y-3">
        <div className="text-xs font-medium text-ink">{props.title}</div>
        <div className="rounded-gf border border-line bg-panel-header p-4">
          <div className="text-xs font-semibold text-ink">
            This table is enlarged below
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            Row selections live in the page-level Selection topology, so they
            survive the move between regions of the page.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-gf border border-line bg-panel-header px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          aria-label={`Return ${props.title} table to grid`}
          onClick={props.onRestore}
        >
          ↙ Return to grid
        </button>
      </div>
    </div>
  );
}
