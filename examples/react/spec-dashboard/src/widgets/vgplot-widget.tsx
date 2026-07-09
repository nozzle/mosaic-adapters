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
 * each select's `as`) and an effect resets a surviving interactor when its
 * committed clause disappears externally (chip ✕ / Clear All). A plot with no
 * (resolvable) selects renders none of this chrome.
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
import { PlotSpecError, buildPlotSpec } from '../spec/plot-interpreter';
import { resolveSelection } from '../spec/topology';
import type { ReactElement } from 'react';
import type { VgPlotElement } from '@nozzleio/react-mosaic';
import type {
  PlotApi,
  PlotDirective,
  PlotGeometry,
} from '../spec/plot-interpreter';
import type { VgplotWidgetSpec } from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';

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
  interactors: Array<{ value?: unknown; reset: () => void }>;
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

  // vgplot marks live on whatever coordinator the API context carries; the bare
  // `vg.*` namespace binds Mosaic's GLOBAL singleton, but this app owns an
  // explicit coordinator. Build the context on it so marks and interactors share
  // the coordinator every client hook uses.
  const coordinator = useMosaicCoordinator();
  const api = useMemo(
    () => vg.createAPIContext({ coordinator }) as unknown as PlotApiContext,
    [coordinator],
  );

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
      });
      const element = api.plot(...directives);
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
  }, [api, topology, widget.plot]);

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

  // An interactor never observes its Selection, so a clause cleared from outside
  // leaves the brush painted. When a select's committed clause is absent, reset
  // the matching interactor (index matches `plot.selects`, i.e. the DSL order)
  // if it still holds a value. Idempotent — a no-op once the overlay is cleared —
  // and it reads committed state, so it cannot fight an in-progress drag.
  useEffect(() => {
    const plot = plotInstance(plotElementRef.current);
    if (plot === undefined) {
      return;
    }
    plotSelects.forEach((select, index) => {
      const value = activeClauses.find((clause) => clause.ref === select.as)
        ?.clause.value;
      const isCommitted =
        value != null && !(Array.isArray(value) && value.length === 0);
      if (isCommitted) {
        return;
      }
      const interactor = plot.interactors[index];
      if (interactor === undefined || interactor.value == null) {
        return;
      }
      interactor.reset();
    });
  }, [activeClauses, plotSelects]);

  const showChrome = resolvableSelects.length > 0;

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
        ) : enabled ? (
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
