import { useCallback, useEffect, useRef } from 'react';
import type { RefCallback } from 'react';
import type { MosaicClient } from '@uwdata/mosaic-core';

export type VgPlotElement = HTMLElement | SVGElement;

/**
 * Mount a vgplot element and disconnect its clients on unmount. Sugar only —
 * vgplot marks are MosaicClients on the shared coordinator and need nothing
 * from us to participate in the Selection graph.
 *
 * The factory is held by latest-ref and invoked on every (re)build, and the
 * detached plot's mark clients are disconnected from their coordinator.
 *
 * ## `deps` — rebuild when captured identities change
 *
 * A plot publishes into whatever Selection instances its factory closed over
 * at build time. When those come from a React-owned lifecycle (e.g. resolved
 * off a `useTopology` topology), their identity can change after the plot is
 * built — most notably on StrictMode's simulated remount, where the plot
 * re-attaches BEFORE the revived topology's re-render, leaving the plot bound
 * to Selections of a destroyed topology: it keeps filtering (relays survive)
 * but nothing observes it, so chip bars, stores, and resets go blind to it.
 * Pass such values in `deps`; the plot is torn down and rebuilt with the
 * latest factory whenever any of them changes (`Object.is`). Module-scope
 * Selections never change identity and need no deps.
 *
 * A rebuild constructs fresh interactors, so any un-committed visual state a
 * previous interactor held (e.g. a brush overlay) does not carry over —
 * acceptable for the identity-change case, which in practice happens before
 * the user has interacted.
 *
 * ```tsx
 * const brush = useMosaicSelectionRef('volumeBrush');
 * const plotRef = useVgPlot(
 *   () =>
 *     vg.plot(
 *       vg.rectY(vg.from('questions', { filterBy: context }), { x: 'v', y: vg.count() }),
 *       vg.intervalX({ as: brush }),
 *     ),
 *   [brush, context],
 * );
 * return <div ref={plotRef} />;
 * ```
 */
export function useVgPlot(
  factory: () => VgPlotElement,
  deps: ReadonlyArray<unknown> = [],
): RefCallback<HTMLElement> {
  const factoryRef = useRef(factory);
  useEffect(() => {
    factoryRef.current = factory;
  });

  const nodeRef = useRef<HTMLElement | null>(null);
  const elementRef = useRef<VgPlotElement | null>(null);
  const prevDepsRef = useRef<ReadonlyArray<unknown> | null>(null);

  const teardown = useCallback(() => {
    const element = elementRef.current;
    if (element === null) {
      return;
    }
    disconnectPlotClients(element);
    element.remove();
    elementRef.current = null;
  }, []);

  const build = useCallback(() => {
    const node = nodeRef.current;
    if (node === null) {
      return;
    }
    teardown();
    const element = factoryRef.current();
    elementRef.current = element;
    node.appendChild(element);
  }, [teardown]);

  // Rebuild when a dep changes identity. Runs after the factory latest-ref
  // effect above (declaration order), so the rebuild always uses the closure
  // of the render that changed the dep — the ref-callback attach below cannot,
  // as refs commit before passive effects update `factoryRef`.
  useEffect(() => {
    const prev = prevDepsRef.current;
    prevDepsRef.current = deps;
    if (prev === null) {
      return;
    }
    const unchanged =
      prev.length === deps.length &&
      deps.every((dep, index) => Object.is(dep, prev[index]));
    if (unchanged) {
      return;
    }
    build();
  });

  return useCallback(
    (node: HTMLElement | null) => {
      if (node === null) {
        nodeRef.current = null;
        teardown();
        return undefined;
      }
      nodeRef.current = node;
      build();
      return () => {
        nodeRef.current = null;
        teardown();
      };
    },
    [build, teardown],
  );
}

/**
 * A vgplot `plot()` element exposes its `Plot` instance as `element.value`
 * (`Object.assign(this.element, { value: this })` in @uwdata/mosaic-plot),
 * and `plot.marks` are the MosaicClients the plot connected. Verified against
 * @uwdata/mosaic-plot v0.29 source.
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
