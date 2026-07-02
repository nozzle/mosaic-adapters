import { useCallback, useEffect, useRef } from 'react';
import type { RefCallback } from 'react';
import type { MosaicClient } from '@uwdata/mosaic-core';

export type VgPlotElement = HTMLElement | SVGElement;

/**
 * Mount a vgplot element and disconnect its clients on unmount. Sugar only —
 * vgplot marks are MosaicClients on the shared coordinator and need nothing
 * from us to participate in the Selection graph.
 *
 * The factory is held by latest-ref and invoked once per attach; StrictMode's
 * simulated remount therefore builds a fresh plot, and the detached plot's
 * mark clients are disconnected from their coordinator.
 *
 * ```tsx
 * const plotRef = useVgPlot(() =>
 *   vg.plot(
 *     vg.dot(vg.from('athletes', { filterBy: $page }), { x: 'weight', y: 'height' }),
 *     vg.intervalXY({ as: $page }),
 *   ),
 * );
 * return <div ref={plotRef} />;
 * ```
 */
export function useVgPlot(
  factory: () => VgPlotElement,
): RefCallback<HTMLElement> {
  const factoryRef = useRef(factory);
  useEffect(() => {
    factoryRef.current = factory;
  });

  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return undefined;
    }
    const element = factoryRef.current();
    node.appendChild(element);
    return () => {
      disconnectPlotClients(element);
      element.remove();
    };
  }, []);
}

/**
 * A vgplot `plot()` element exposes its `Plot` instance as `element.value`
 * (`Object.assign(this.element, { value: this })` in @uwdata/mosaic-plot),
 * and `plot.marks` are the MosaicClients the plot connected. Verified against
 * @uwdata/mosaic-plot v0.27 source.
 */
function disconnectPlotClients(element: VgPlotElement): void {
  const plot = (element as { value?: { marks?: unknown } }).value;
  const marks = plot?.marks;
  if (!Array.isArray(marks)) {
    return;
  }
  for (const mark of marks) {
    if (isClientLike(mark)) {
      mark.destroy();
    }
  }
}

function isClientLike(value: unknown): value is Pick<MosaicClient, 'destroy'> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'destroy' in value &&
    typeof (value as MosaicClient).destroy === 'function'
  );
}
