/**
 * A single KPI card: one `useMosaicValues` client reading a `value` column from
 * the widget's compiled raw-template query, formatted through the formatter
 * registry.
 *
 * CRITICAL cross-filter contract: when the spec omits `filter_by`, the card must
 * NOT join the cross-filter topology at all — we pass NO `filterBy` to the
 * client, so its query receives no predicates and the value stays constant under
 * any filter, brush, or selection. When `filter_by` is present it resolves to a
 * Selection by ref.
 */
import { useMemo } from 'react';
import { useMosaicValues } from '@nozzleio/react-mosaic';
import { compileQuery } from '../spec/query-compiler';
import { compileExclude } from '../spec/exclude';
import { resolveSelection } from '../spec/topology';
import { getFormatter } from './formatters';
import type { ReactElement } from 'react';
import type { ValuesInputs } from '@nozzleio/react-mosaic';
import type { KpiCardWidgetSpec } from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';

/** The single row/column shape every KPI query returns. */
interface KpiValues extends Record<string, unknown> {
  value: unknown;
}

/**
 * Thin narrowing wrapper. The registry hands every component the widget union;
 * we narrow to this renderer here and render the inner card so that all hooks
 * run unconditionally (rules-of-hooks) on the already-narrowed widget.
 */
export function KpiWidget({
  widget,
  context,
}: WidgetComponentProps): ReactElement | null {
  if (widget.renderer !== 'kpi-card') {
    return null;
  }
  return <KpiCard widget={widget} context={context} />;
}

interface KpiCardProps {
  widget: KpiCardWidgetSpec;
  context: WidgetContext;
}

function KpiCard({ widget, context }: KpiCardProps): ReactElement {
  const { topology, enabled } = context;

  const filterBy = resolveSelection(topology, widget.filter_by);
  // Query is held latest-ref by the client (a new identity never re-queries),
  // but memoize anyway so the compile runs once per spec.
  const query = useMemo(
    () => compileQuery<ValuesInputs>(widget.query),
    [widget.query],
  );
  // `exclude` (see spec/exclude.ts): `'all'` drops filterBy (full opt-out); a
  // list yields a stable `skipSources` set dropping just those clauses.
  const exclude = useMemo(
    () => compileExclude(widget.exclude),
    [widget.exclude],
  );
  const applyFilterBy = filterBy !== undefined && !exclude.omitFilterBy;

  const result = useMosaicValues<KpiValues>({
    query,
    // Honor the opt-out contract: no `filterBy` key at all when absent or when
    // `exclude: all` drops it.
    ...(applyFilterBy ? { filterBy } : {}),
    ...(exclude.skipSources !== undefined
      ? { skipSources: exclude.skipSources }
      : {}),
    enabled,
  });

  const formatter = getFormatter(widget.format);
  const display =
    result.values === undefined ? '…' : formatter(result.values.value);

  // A subtle Grafana-stat cue: cross-filtered stats read green, the opt-out
  // ("all data") stat reads viz-blue so the constant one is visibly distinct.
  const valueColor =
    widget.filter_by === undefined ? 'text-gf-viz-blue' : 'text-gf-green';

  return (
    <div
      data-testid={`kpi-${widget.id}`}
      className="flex h-full min-h-24 flex-col rounded-gf border border-line bg-panel transition-colors hover:border-line-strong"
    >
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted">
        {widget.label}
      </div>
      <div className="flex flex-1 items-center justify-center px-3 py-2">
        <div
          data-testid={`kpi-${widget.id}-value`}
          className={`text-[32px] leading-none font-semibold tabular-nums ${valueColor}`}
        >
          {display}
        </div>
      </div>
    </div>
  );
}
