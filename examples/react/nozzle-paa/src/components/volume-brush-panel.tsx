/**
 * A search-volume histogram whose drag-brush publishes a foreign interval
 * clause directly to a topology Selection — like the domain spotlight, and
 * never through the FilterSet (issue #181).
 *
 * Search volume is steeply right-skewed (most rows cluster low; a long tail
 * reaches ~90k), so the x-scale is log and brushing the tail can slice the page
 * down to a handful of high-demand keywords.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicActiveClauses,
  useMosaicSelectionRef,
  useVgPlot,
} from '@nozzleio/react-mosaic';
import {
  VOLUME_BRUSH_COLUMN,
  VOLUME_BRUSH_ENTRY,
  tableName,
} from '../page-context';
import { usePageContexts } from '../topology';
import type { VgPlotElement } from '@nozzleio/react-mosaic';

/** The slice of the vgplot `Plot` instance (exposed as `element.value`) this panel drives. */
interface PlotInstance {
  setAttribute: (name: string, value: unknown) => unknown;
  render: () => Promise<unknown>;
  interactors: Array<{ value?: unknown; reset: () => void }>;
}

/** Compact (collapsed) vs. expanded plot geometry, applied via attributes. */
interface PlotSize {
  width: number;
  height: number;
  marginLeft: number;
  marginBottom: number;
  yTicks: number;
}

const COMPACT_SIZE: PlotSize = {
  width: 320,
  height: 90,
  marginLeft: 12,
  marginBottom: 18,
  yTicks: 0,
};

const EXPANDED_SIZE: PlotSize = {
  width: 900,
  height: 300,
  marginLeft: 44,
  marginBottom: 34,
  yTicks: 4,
};

/** Violet brush rectangle, for contrast against the teal histogram bars. */
const BRUSH_STYLE = {
  fill: '#8b5cf6',
  fillOpacity: 0.22,
  stroke: '#7c3aed',
} as const;

/** Formats a brushed `[min, max]` range for the compact summary strip. */
function formatRange(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 2) {
    return 'Full range';
  }
  const [lo, hi] = value as [number, number];
  const round = (n: number) => Math.round(n).toLocaleString('en-US');
  return `${round(lo)} – ${round(hi)}`;
}

export function VolumeBrushPanel(props: { enabled: boolean }) {
  const { enabled } = props;
  const [expanded, setExpanded] = useState(false);
  const { volumeBrushFilterBy } = usePageContexts();
  const volumeBrush = useMosaicSelectionRef(VOLUME_BRUSH_ENTRY);

  // Derive the strip's range from the committed clause, so it reflects external
  // clears (chip ✕, Clear All) and a hydrated range.
  const foreign = useMosaicActiveClauses();
  const committed = foreign.find((clause) => clause.ref === VOLUME_BRUSH_ENTRY)
    ?.clause.value;
  const rangeLabel = formatRange(committed);
  const hasRange = Array.isArray(committed) && committed.length === 2;

  // The single plot element, so the resize effect can reach its `Plot`
  // instance (exposed as `element.value`) without rebuilding it.
  const plotElementRef = useRef<VgPlotElement | null>(null);

  // The geometry the factory builds at, kept current by the resize effect so a
  // deps-triggered rebuild comes up at the active mode's size, not compact.
  const sizeRef = useRef<PlotSize>(COMPACT_SIZE);

  // The captured Selections are topology-owned and change identity when the
  // topology is recreated (StrictMode remount in dev). Passing them as deps
  // rebuilds the plot against the live instances; otherwise it would publish
  // into a destroyed topology's Selection — still filtering via relays, but
  // invisible to the active-clause store (no chip, no range strip).
  const attachPlot = useVgPlot(() => {
    const size = sizeRef.current;
    const element = vg.plot(
      // The bars read the self-excluding context (page minus this brush's own
      // clause), so they cascade with every other filter but not this one —
      // the same pattern as the summary cards.
      vg.rectY(vg.from(tableName, { filterBy: volumeBrushFilterBy }), {
        x: vg.bin(VOLUME_BRUSH_COLUMN),
        y: vg.count(),
        fill: '#0e7490',
        inset: 0.5,
      }),
      // The brush publishes its `[min, max]` interval into the foreign
      // `volumeBrush` Selection, resolved by ref.
      vg.intervalX({
        as: volumeBrush,
        brush: BRUSH_STYLE,
      }),
      vg.xScale('log'),
      vg.xDomain(vg.Fixed),
      vg.xLabel('Search volume →'),
      vg.yLabel(null),
      vg.yTicks(size.yTicks),
      vg.marginLeft(size.marginLeft),
      vg.marginBottom(size.marginBottom),
      vg.width(size.width),
      vg.height(size.height),
    );
    plotElementRef.current = element;
    return element;
  }, [volumeBrush, volumeBrushFilterBy]);

  // Clear the ref on detach so a stale (disconnected) plot is never resized.
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

  // Resize in place on toggle rather than remounting the plot. Interval1D
  // repaints its brush overlay only from the interactor's own `this.value` and
  // never observes the Selection, so a remount would build a fresh interactor
  // (`this.value` undefined) and the overlay would vanish even though the
  // clause is still live. Instead, set the mode's size attributes and force a
  // synchronous render, which re-runs the surviving interactor's `init` and
  // repaints the overlay. Render, not `update()`, whose no-arg path defers
  // behind in-flight mark queries (observed multi-second stale sizes).
  useEffect(() => {
    const next = expanded ? EXPANDED_SIZE : COMPACT_SIZE;
    sizeRef.current = next;
    const plot = (plotElementRef.current as { value?: PlotInstance } | null)
      ?.value;
    if (plot === undefined) {
      return;
    }
    plot.setAttribute('width', next.width);
    plot.setAttribute('height', next.height);
    plot.setAttribute('marginLeft', next.marginLeft);
    plot.setAttribute('marginBottom', next.marginBottom);
    plot.setAttribute('yTicks', next.yTicks);
    void plot.render();
  }, [expanded]);

  // Because the interactor never observes the Selection (see the resize
  // effect), a clause cleared from outside (chip ✕, Clear All) leaves the brush
  // rectangle painted. When no committed clause remains, reset the interactor
  // to clear its value and the overlay. This fires only on the committed-state
  // transition, which settles after a drag has published, so it cannot fight an
  // in-progress drag.
  useEffect(() => {
    if (hasRange) {
      return;
    }
    const plot = (plotElementRef.current as { value?: PlotInstance } | null)
      ?.value;
    const interactor = plot?.interactors[0];
    if (interactor === undefined || interactor.value == null) {
      return;
    }
    interactor.reset();
  }, [hasRange]);

  return (
    <figure
      data-testid="volume-brush-panel"
      data-expanded={expanded ? 'true' : 'false'}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <figcaption className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            Search Volume
          </figcaption>
          <div
            className="text-sm font-semibold text-slate-800"
            data-testid="volume-brush-range"
          >
            {hasRange ? rangeLabel : 'Full range — drag to brush'}
          </div>
        </div>
        <button
          type="button"
          data-testid="volume-brush-toggle"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? 'Collapse the search volume brush'
              : 'Expand the search volume brush'
          }
          disabled={!enabled}
          className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? '↙ Collapse' : '↗ Expand'}
        </button>
      </div>
      <div
        data-testid="volume-brush-plot"
        className="overflow-x-auto"
        ref={plotRef}
      />
      {expanded ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Drag across the bars to brush a search-volume range. The range filters
          every widget on the page and appears as a removable chip above.
        </p>
      ) : null}
    </figure>
  );
}
