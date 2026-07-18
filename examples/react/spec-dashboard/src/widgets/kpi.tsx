/**
 * A single KPI card: one `useMosaicValues` client reading a `value` column from
 * the widget's compiled query (raw-template or structured), formatted through
 * the formatter registry. A structured `$name` select column binds a topology
 * variable (passed to the client as `params`, so a variable change re-queries).
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
import { resolveSelection, resolveVariable } from '../spec/topology';
import { getFormatter } from './formatters';
import type { ReactElement } from 'react';
import type { Param } from '@uwdata/mosaic-core';
import type { ParamLike } from '@uwdata/mosaic-sql';
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
  // The query may be raw-template (`type: sql`) or structured (`type: select`).
  // A structured `$name` select column compiles to a `column(param)` named by
  // the variable's value — the compiler stays pure by taking a resolver (topology
  // access is the widget's) and reports back which variables it bound, so we hand
  // them to the client as `params` (a variable change then re-queries). The raw
  // path binds no variables, so the compile just yields a source factory. Memoize
  // so the compile runs once per spec (the query is held latest-ref by the client).
  const compiled = useMemo(
    () =>
      compileQuery<ValuesInputs>(
        widget.query,
        (name) => resolveVariable(topology, name) as ParamLike,
      ),
    [widget.query, topology],
  );
  const query = compiled.source;
  const params = useMemo(() => {
    const bound: Record<string, Param<unknown>> = {};
    for (const name of compiled.variables) {
      bound[name] = resolveVariable(topology, name) as Param<unknown>;
    }
    return bound;
  }, [compiled, topology]);
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
    ...(compiled.variables.length > 0 ? { params } : {}),
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
