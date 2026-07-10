/**
 * The generic `vgplot` renderer: compiles the spec's app-owned plot DSL into a
 * live vgplot plot via the pure interpreter (`buildPlotSpec`), on an API context
 * bound to the app coordinator. It is fully domain-blind — every mark, scale,
 * and interactor comes from the spec; the renderer owns only geometry and chrome.
 *
 * ## Readiness gating
 *
 * NOTHING vgplot is constructed until `context.enabled` is true: the plot wrapper
 * (and its `useVgPlot` ref) only mounts once enabled, so `api.plot(...)` — the
 * sole call that connects mark clients and fires queries — cannot run before the
 * data load finishes and the derived tables exist. Constructing a mark against a
 * table that `CREATE TABLE` has not yet produced would throw (a DuckDB catalog
 * error plus a vgplot `exclusiveFacets` TypeError on undefined mark data). Until
 * enabled a lightweight loading shell renders.
 *
 * ## Fixed-domain resolution (renderer-owned, unfiltered extent)
 *
 * A `fixed` axis in the DSL means the FULL UNFILTERED extent of its source
 * column — frozen so brushing never rescales it. The interpreter cannot express
 * that with vgplot's `Fixed` sentinel alone, because `Fixed` freezes to the
 * FIRST rendered query, and filter hydration runs synchronously before that
 * first query (zero flash). Any hydrated filter (a default, a shared link) would
 * then freeze the axis to the FILTERED extent, so widening the filter squashes
 * the visible bars flat. Instead, once data is loaded this renderer resolves the
 * declared `fixed` axes to their unfiltered `[min, max]` via a one-off
 * `SELECT min(col), max(col) FROM <base table>` (no `filterBy`) through the app
 * coordinator, and hands the explicit domains to the interpreter. The plot is
 * gated on that resolution so it never mounts against the poisoned `Fixed`
 * domain. An axis whose channel is not a plain/binned column, or whose query
 * fails, falls back to vgplot `Fixed`.
 *
 * ## Geometry (renderer-owned)
 *
 * The DSL carries no size. A ResizeObserver measures the card's content box and
 * derives the plot width (with a floor); height comes from a base budget that
 * grows when expanded. Size changes and expand/collapse are applied by MUTATING
 * the built plot's `width`/`height`/`margin*`/`*Ticks` attributes in place and
 * calling `render()` — never by rebuilding, because a vgplot interval interactor
 * repaints its brush overlay only from its own value; a rebuild would drop a live
 * brush. Observer callbacks are frame-throttled.
 *
 * ## Select chrome (generic)
 *
 * If the plot declares `selects` whose `as` refs resolve in the topology, a
 * committed-value strip reads the active clauses (matching clause `ref` against
 * each select's `as`) and a narrow compatibility adapter makes each interactor
 * adopt externally committed values (URL hydration or a sibling renderer) and
 * clears it after chip ✕ / Clear All. A plot with no resolvable selects renders
 * none of this chrome.
 *
 * `PlotSpecError` (or any build failure from unresolved refs) is caught and shown
 * as an inline error card rather than crashing the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicActiveClauses,
  useMosaicCoordinator,
  useVgPlot,
} from '@nozzleio/react-mosaic';
import {
  PlotSpecError,
  buildPlotSpec,
  collectFixedDomainRequests,
} from '../spec/plot-interpreter';
import { resolveSelection } from '../spec/topology';
import { syncVgplotSelectionInteractors } from './vgplot-selection-sync';
import type { ReactElement } from 'react';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { VgPlotElement } from '@nozzleio/react-mosaic';
import type {
  DomainBounds,
  FixedDomainRequest,
  FixedDomains,
  PlotApi,
  PlotDirective,
  PlotGeometry,
} from '../spec/plot-interpreter';
import type { VgplotWidgetSpec } from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';
import type {
  VgplotSelectionBinding,
  VgplotSelectionInteractor,
} from './vgplot-selection-sync';

/** Floor width so a narrow column never collapses the plot to nothing. */
const MIN_WIDTH = 240;
/** Collapsed vs. expanded plot height budgets (px). */
const BASE_HEIGHT = 180;
const EXPANDED_HEIGHT = 380;

/**
 * The vgplot API context. `createAPIContext()` is typed `any` upstream; narrow
 * it once here to the interpreter's {@link PlotApi} plus the `plot(...)` builder
 * the renderer itself calls.
 */
type PlotApiContext = PlotApi & {
  plot: (...directives: Array<PlotDirective>) => VgPlotElement;
};

/** The slice of the built `Plot` instance (exposed as `element.value`) we drive. */
interface PlotInstance {
  setAttribute: (name: string, value: unknown) => unknown;
  render: () => Promise<unknown>;
  interactors: Array<VgplotSelectionInteractor>;
}

/** Fully-resolved geometry for the current width + expand state. */
function geometryFor(width: number, expanded: boolean): Required<PlotGeometry> {
  return {
    width,
    height: expanded ? EXPANDED_HEIGHT : BASE_HEIGHT,
    marginTop: 16,
    marginRight: 16,
    marginBottom: 34,
    marginLeft: 44,
    xTicks: expanded ? 8 : 5,
    yTicks: expanded ? 5 : 3,
  };
}

/** Format a committed selection value generically for the chrome strip. */
function formatSelectValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      value.every(
        (interval) =>
          Array.isArray(interval) &&
          interval.length === 2 &&
          interval.every((bound) => typeof bound === 'number'),
      )
    ) {
      return value.map((interval) => formatSelectValue(interval)).join(' × ');
    }
    if (value.length === 2 && value.every((n) => typeof n === 'number')) {
      const [lo, hi] = value as [number, number];
      const round = (n: number) => Math.round(n).toLocaleString('en-US');
      return `${round(lo)} – ${round(hi)}`;
    }
    return value.map((entry) => String(entry)).join(', ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/** Read the built `Plot` instance off a vgplot element, if present. */
function plotInstance(element: VgPlotElement | null): PlotInstance | undefined {
  return (element as { value?: PlotInstance } | null)?.value ?? undefined;
}

/** Coerce a DuckDB min/max cell to a finite number or a Date, or `null`. */
function toDomainBound(value: unknown): number | Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** The first row of a coordinator arrow result as a name-keyed record, or null. */
function firstRow(result: unknown): Record<string, unknown> | null {
  const table = result as { get?: (index: number) => unknown } | null;
  const row = table?.get?.(0);
  return row != null && typeof row === 'object'
    ? (row as Record<string, unknown>)
    : null;
}

/**
 * `min(col)` / `max(col)`, restricted to positive rows when the axis is
 * log-scaled — mosaic's log binning drops rows ≤ 0, so the extent must match the
 * rendered support or the domain stretches below it and degenerates the axis.
 */
function extentAggregate(
  fn: 'min' | 'max',
  column: string,
  positiveOnly: boolean,
): string {
  if (!positiveOnly) {
    return `${fn}(${column})`;
  }
  return `${fn}(${column}) FILTER (${column} > 0)`;
}

/**
 * Resolve one `fixed` axis to its FULL unfiltered extent via an unfiltered
 * min/max query (no `filterBy`) against the mark's base table. Returns `null`
 * (→ fall back to vgplot `Fixed`) when a bound is missing/non-finite; an `xy`
 * request unions its two column extents. The aggregate targets the raw column
 * name, matching how the plot DSL feeds it to vgplot's `bin`; a log-scaled axis
 * reads only positive rows (see {@link extentAggregate}).
 */
async function resolveFixedDomain(
  coordinator: Coordinator,
  request: FixedDomainRequest,
): Promise<DomainBounds | null> {
  const { positiveOnly } = request;
  if (request.axis === 'xy') {
    const [xColumn, yColumn] = request.columns;
    if (xColumn === undefined || yColumn === undefined) {
      return null;
    }
    const result = await coordinator.query(
      `SELECT ${extentAggregate('min', xColumn, positiveOnly)} AS x_lo, ` +
        `${extentAggregate('max', xColumn, positiveOnly)} AS x_hi, ` +
        `${extentAggregate('min', yColumn, positiveOnly)} AS y_lo, ` +
        `${extentAggregate('max', yColumn, positiveOnly)} AS y_hi ` +
        `FROM ${request.table}`,
      { type: 'arrow' },
    );
    const row = firstRow(result);
    if (row === null) {
      return null;
    }
    const bounds = [
      toDomainBound(row.x_lo),
      toDomainBound(row.x_hi),
      toDomainBound(row.y_lo),
      toDomainBound(row.y_hi),
    ];
    if (bounds.some((bound) => typeof bound !== 'number')) {
      return null;
    }
    const [xLo, xHi, yLo, yHi] = bounds as [number, number, number, number];
    return [Math.min(xLo, yLo), Math.max(xHi, yHi)];
  }

  const [column] = request.columns;
  if (column === undefined) {
    return null;
  }
  const result = await coordinator.query(
    `SELECT ${extentAggregate('min', column, positiveOnly)} AS lo, ` +
      `${extentAggregate('max', column, positiveOnly)} AS hi ` +
      `FROM ${request.table}`,
    { type: 'arrow' },
  );
  const row = firstRow(result);
  if (row === null) {
    return null;
  }
  const lo = toDomainBound(row.lo);
  const hi = toDomainBound(row.hi);
  if (lo === null || hi === null) {
    return null;
  }
  return [lo, hi];
}

/**
 * Thin narrowing wrapper. Narrow to this renderer and hand the already-narrowed
 * widget to the inner figure so every hook runs unconditionally (rules-of-hooks).
 */
export function VgplotWidget({
  widget,
  context,
}: WidgetComponentProps): ReactElement | null {
  if (widget.renderer !== 'vgplot') {
    return null;
  }
  return <VgplotFigure widget={widget} context={context} />;
}

interface VgplotFigureProps {
  widget: VgplotWidgetSpec;
  context: WidgetContext;
}

function VgplotFigure({ widget, context }: VgplotFigureProps): ReactElement {
  const { topology, enabled } = context;
  const [expanded, setExpanded] = useState(false);
  const [plotWidth, setPlotWidth] = useState(MIN_WIDTH);
  const [specError, setSpecError] = useState<string | null>(null);
  // Resolved unfiltered `fixed`-axis domains, or `null` until resolution runs.
  // `{}` means resolution finished with nothing to pin (every `fixed` axis falls
  // back to vgplot `Fixed`). The plot is gated on this being non-null so it never
  // mounts against the first-render-frozen (poisoned) `Fixed` domain.
  const [fixedDomains, setFixedDomains] = useState<FixedDomains | null>(null);

  // vgplot marks live on whatever coordinator the API context carries; the bare
  // `vg.*` namespace binds Mosaic's GLOBAL singleton, but this app owns an
  // explicit coordinator. Build the context on it so marks and interactors share
  // the coordinator every client hook uses.
  const coordinator = useMosaicCoordinator();
  const api = useMemo(
    () => vg.createAPIContext({ coordinator }) as unknown as PlotApiContext,
    [coordinator],
  );

  // The `fixed` axes that need an unfiltered-extent query (none → the plot has
  // no explicit domain to resolve and never waits on one).
  const fixedRequests = useMemo(
    () => collectFixedDomainRequests(widget.plot),
    [widget.plot],
  );

  // Resolve the declared `fixed` axes to their FULL unfiltered extent once the
  // data load finishes. Runs off the coordinator directly (no mark client, no
  // `filterBy`), so it reads the whole base table regardless of the filters
  // hydrated at mount. A failed query falls back to `Fixed` for every axis
  // rather than blocking the plot. Reruns only on a coordinator / plot change.
  useEffect(() => {
    if (!enabled || fixedRequests.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.all(
      fixedRequests.map(async (request) => ({
        axis: request.axis,
        bounds: await resolveFixedDomain(coordinator, request),
      })),
    )
      .then((results) => {
        if (cancelled) {
          return;
        }
        const resolved: FixedDomains = {};
        for (const result of results) {
          if (result.bounds !== null) {
            resolved[result.axis] = result.bounds;
          }
        }
        setFixedDomains(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          setFixedDomains({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, coordinator, fixedRequests]);

  // The built plot element, so the resize / reset effects can reach its `Plot`
  // instance (`element.value`) without rebuilding it.
  const plotElementRef = useRef<VgPlotElement | null>(null);
  // The geometry the factory builds at, kept current so a deps-triggered rebuild
  // comes up at the active size, not the initial one.
  const geometryRef = useRef<Required<PlotGeometry>>(
    geometryFor(MIN_WIDTH, false),
  );
  // The card content box we measure for width (present in every state, so the
  // width is known before the plot mounts).
  const measureRef = useRef<HTMLDivElement | null>(null);

  const plotSelects = useMemo(() => widget.plot.selects ?? [], [widget.plot]);
  const activeClauses = useMosaicActiveClauses();

  // Selects whose `as` resolves in the topology drive the chrome. A plot with
  // none renders no selection chrome at all.
  const resolvableSelects = useMemo(
    () => plotSelects.filter((select) => topology.validNames.has(select.as)),
    [plotSelects, topology],
  );

  // Committed value per resolvable select, read back from the active clauses so
  // it reflects external clears (chip ✕, Clear All) and hydration.
  const committed = useMemo(
    () =>
      resolvableSelects.map((select) => ({
        name: select.as,
        value: activeClauses.find((clause) => clause.ref === select.as)?.clause
          .value,
      })),
    [resolvableSelects, activeClauses],
  );
  const hasCommitted = committed.some(
    (entry) =>
      entry.value != null &&
      !(Array.isArray(entry.value) && entry.value.length === 0),
  );
  const selectionBindings = useMemo<Array<VgplotSelectionBinding>>(
    () =>
      resolvableSelects.map((select) => ({
        selection: topology.resolve(select.as),
        kind: select.select,
        active: activeClauses.some((clause) => clause.ref === select.as),
        value: activeClauses.find((clause) => clause.ref === select.as)?.clause
          .value,
      })),
    [activeClauses, resolvableSelects, topology],
  );

  // Build the plot from the spec's DSL. Held by latest-ref inside `useVgPlot`;
  // rebuilt only when the coordinator-bound `api` or the topology identity
  // changes. Guarded so a spec-vocabulary / unresolved-ref failure renders an
  // inline error card instead of crashing.
  const attachPlot = useVgPlot(() => {
    try {
      const directives = buildPlotSpec(widget.plot, {
        api,
        resolveSelection: (name) => resolveSelection(topology, name),
        geometry: geometryRef.current,
        // Non-null by mount time (the plot is gated on resolution below).
        ...(fixedDomains !== null ? { fixedDomains } : {}),
      });
      const element = api.plot(...directives);
      const plot = plotInstance(element);
      if (plot !== undefined) {
        // The initial plot render is frame-scheduled by vgplot. Seed values now
        // so interval interactors paint URL-restored state on their first pass.
        syncVgplotSelectionInteractors(plot.interactors, selectionBindings);
      }
      plotElementRef.current = element;
      setSpecError((prev) => (prev === null ? prev : null));
      return element;
    } catch (error) {
      const message =
        error instanceof PlotSpecError || error instanceof Error
          ? error.message
          : String(error);
      setSpecError(message);
      // Return an empty element so `useVgPlot` has something to mount; the render
      // below swaps to the error card, unmounting it on the next commit.
      return document.createElement('div');
    }
  }, [api, topology, widget.plot, fixedDomains]);

  // Clear the ref on detach so a stale (disconnected) plot is never mutated.
  const plotRef = useCallback(
    (node: HTMLElement | null) => {
      const cleanup = attachPlot(node);
      if (node === null) {
        plotElementRef.current = null;
      }
      return cleanup;
    },
    [attachPlot],
  );

  // Frame-throttled width measurement. Observes an always-present box, so the
  // width is settled before the plot mounts (and cannot feed back: the plot is
  // sized to ≤ the box width and never grows it).
  useEffect(() => {
    const element = measureRef.current;
    if (element === null) {
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) {
        return;
      }
      const next = Math.max(MIN_WIDTH, Math.floor(entry.contentRect.width));
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPlotWidth((prev) => (prev === next ? prev : next));
      });
    });
    observer.observe(element);
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, []);

  // Apply width / expand changes in place (never rebuild while a brush is live).
  useEffect(() => {
    const geometry = geometryFor(plotWidth, expanded);
    geometryRef.current = geometry;
    const plot = plotInstance(plotElementRef.current);
    if (plot === undefined) {
      return;
    }
    plot.setAttribute('width', geometry.width);
    plot.setAttribute('height', geometry.height);
    plot.setAttribute('marginTop', geometry.marginTop);
    plot.setAttribute('marginRight', geometry.marginRight);
    plot.setAttribute('marginBottom', geometry.marginBottom);
    plot.setAttribute('marginLeft', geometry.marginLeft);
    plot.setAttribute('xTicks', geometry.xTicks);
    plot.setAttribute('yTicks', geometry.yTicks);
    void plot.render();
  }, [plotWidth, expanded, specError]);

  // Interactors publish but do not observe their Selection. Adopt any value
  // committed by URL hydration or a sibling renderer, and reset on an external
  // clear. Matching is by Selection identity, never fragile DSL-array position.
  useEffect(() => {
    const plot = plotInstance(plotElementRef.current);
    if (plot === undefined) {
      return;
    }
    syncVgplotSelectionInteractors(plot.interactors, selectionBindings);
  }, [selectionBindings]);

  const showChrome = resolvableSelects.length > 0;
  // Mount the plot only once the data has loaded AND (if it declares resolvable
  // `fixed` axes) their unfiltered domains have resolved, so it never comes up
  // against the first-render-frozen `Fixed`. A plot with no resolvable fixed
  // axis never waits.
  const plotReady =
    enabled && (fixedRequests.length === 0 || fixedDomains !== null);

  return (
    <figure
      data-testid={`vgplot-${widget.id}`}
      data-expanded={expanded ? 'true' : 'false'}
      className="flex flex-col rounded-gf border border-line bg-panel transition-colors hover:border-line-strong"
    >
      <div className="flex h-[30px] shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <figcaption className="shrink-0 text-xs font-medium text-ink">
            {widget.label}
          </figcaption>
          {showChrome ? (
            <span
              data-testid={`vgplot-${widget.id}-range`}
              className="truncate text-[11px] text-muted"
            >
              {hasCommitted
                ? committed
                    .filter(
                      (entry) =>
                        entry.value != null &&
                        !(
                          Array.isArray(entry.value) && entry.value.length === 0
                        ),
                    )
                    .map((entry) => formatSelectValue(entry.value))
                    .join('  ·  ')
                : 'Full range — drag to brush'}
            </span>
          ) : null}
        </div>
        {widget.expandable ? (
          <button
            type="button"
            data-testid={`vgplot-${widget.id}-toggle`}
            aria-expanded={expanded}
            aria-label={
              expanded ? `Collapse ${widget.label}` : `Expand ${widget.label}`
            }
            disabled={!enabled}
            className="flex h-6 shrink-0 items-center rounded-gf border border-line bg-panel-header px-2 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue disabled:opacity-50"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? '↙ Collapse' : '↗ Expand'}
          </button>
        ) : null}
      </div>

      <div ref={measureRef} className="w-full p-2">
        {specError !== null ? (
          <div
            data-testid={`vgplot-${widget.id}-error`}
            className="rounded-gf border border-line border-l-2 border-l-gf-red bg-gf-red/10 p-3 text-xs text-ink"
          >
            Plot spec error: {specError}
          </div>
        ) : plotReady ? (
          <div
            data-testid={`vgplot-${widget.id}-plot`}
            className="overflow-x-auto"
            ref={plotRef}
          />
        ) : (
          <div
            data-testid={`vgplot-${widget.id}-loading`}
            className="animate-pulse rounded-gf bg-hover"
            style={{ height: geometryFor(plotWidth, expanded).height }}
          />
        )}
      </div>

      {showChrome && expanded ? (
        <p className="px-3 pb-2 text-[11px] text-faint">
          Drag across the plot to brush a range. The range cross-filters every
          widget on the page and appears as a removable chip above.
        </p>
      ) : null}
    </figure>
  );
}
