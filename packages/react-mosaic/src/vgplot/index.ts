import type { Coordinator, MosaicClient } from '@uwdata/mosaic-core';
import { useCallback, useEffect, useRef } from 'react';
import type { RefCallback } from 'react';

import { useMosaicCoordinator } from '../context';
import { getVgPlotApi } from './api-context';
import type { VgPlotApi } from './api-context';

export type { VgPlotApi, VgPlotApiContext, VgPlotNamedPlots } from './api-context';

export type VgPlotElement = HTMLElement | SVGElement;

/**
 * Builds the element `useVgPlot` mounts. Receives the vgplot API context bound
 * to the hook's resolved coordinator; a zero-argument factory (e.g. one built
 * with the bare `vg.*` namespace) is accepted too.
 */
export type VgPlotFactory = (api: VgPlotApi) => VgPlotElement;

export interface UseVgPlotOptions {
  /**
   * The coordinator the factory's `api` is bound to (and that the dev-mode
   * mismatch check compares the plot's marks against). Defaults to the nearest
   * `MosaicProvider`, then the global coordinator (the global only when there
   * is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
}

/**
 * Mount a vgplot element and disconnect its clients on unmount. vgplot marks
 * are MosaicClients and need nothing from us to participate in the Selection
 * graph — the hook's only job beyond mounting is handing the factory an API
 * context bound to the right coordinator.
 *
 * The factory is held by latest-ref and invoked on every (re)build with
 * `api`: the vgplot namespace bound (via upstream `createAPIContext`) to the
 * coordinator resolved from `options.coordinator` → nearest `MosaicProvider` →
 * the global coordinator. Build every mark, interactor, and input through
 * `api` (`api.plot(...)`, `api.from(...)`, `api.intervalX(...)`) so the plot
 * queries the same coordinator as the data hooks; the bare `vg.*` namespace
 * always binds to the global coordinator. The context is shared per
 * coordinator, so cross-plot naming (`api.name`, legends' `for`) works across
 * plots. The detached plot's mark clients are disconnected from their
 * coordinator.
 *
 * In development, if the built plot's marks are connected to a different
 * coordinator than the resolved one (typically a bare `vg.plot(...)` under a
 * `MosaicProvider`), the hook warns once.
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
 * Selections never change identity and need no deps. The resolved coordinator
 * is an implicit dep: a new coordinator (e.g. a reconnect) rebuilds the plot
 * against a fresh `api`.
 *
 * A rebuild constructs fresh interactors, so any un-committed visual state a
 * previous interactor held (e.g. a brush overlay) does not carry over —
 * acceptable for the identity-change case, which in practice happens before
 * the user has interacted.
 *
 * ```tsx
 * const brush = useMosaicSelectionRef('volumeBrush');
 * const plotRef = useVgPlot(
 *   (api) =>
 *     api.plot(
 *       api.rectY(api.from('questions', { filterBy: context }), { x: 'v', y: api.count() }),
 *       api.intervalX({ as: brush }),
 *     ),
 *   [brush, context],
 * );
 * return <div ref={plotRef} />;
 * ```
 */
export function useVgPlot(
  factory: VgPlotFactory,
  deps: ReadonlyArray<unknown> = [],
  options: UseVgPlotOptions = {},
): RefCallback<HTMLElement> {
  const coordinator = useMosaicCoordinator(options.coordinator);

  const factoryRef = useRef(factory);
  const coordinatorRef = useRef(coordinator);
  useEffect(() => {
    factoryRef.current = factory;
    coordinatorRef.current = coordinator;
  });

  const nodeRef = useRef<HTMLElement | null>(null);
  const elementRef = useRef<VgPlotElement | null>(null);
  const prevDepsRef = useRef<ReadonlyArray<unknown> | null>(null);
  const warnedRef = useRef(false);

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
    const expected = coordinatorRef.current;
    const element = factoryRef.current(getVgPlotApi(expected));
    elementRef.current = element;
    node.appendChild(element);
    if (warnedRef.current) {
      return;
    }
    if (isProductionBuild()) {
      return;
    }
    warnedRef.current = warnOnCoordinatorMismatch(element, expected);
  }, [teardown]);

  // Rebuild when a dep — or the resolved coordinator — changes identity. Runs
  // after the latest-ref effect above (declaration order), so the rebuild
  // always uses the factory and coordinator of the render that changed the
  // dep — the ref-callback attach below cannot, as refs commit before passive
  // effects update `factoryRef`.
  const allDeps = [coordinator, ...deps];
  useEffect(() => {
    const prev = prevDepsRef.current;
    prevDepsRef.current = allDeps;
    if (prev === null) {
      return;
    }
    const unchanged =
      prev.length === allDeps.length && allDeps.every((dep, index) => Object.is(dep, prev[index]));
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
 * @uwdata/mosaic-plot v0.32 source (the `plot.js` element/value contract is
 * unchanged since v0.29.1).
 */
function plotMarks(element: VgPlotElement): Array<unknown> {
  const plot = (element as { value?: { marks?: unknown } }).value;
  const marks = plot?.marks;
  if (!Array.isArray(marks)) {
    return [];
  }
  return marks;
}

function disconnectPlotClients(element: VgPlotElement): void {
  for (const mark of plotMarks(element)) {
    if (isClientLike(mark)) {
      mark.destroy();
    }
  }
}

/**
 * Warn when any of the plot's marks connected to a coordinator other than
 * `expected`. `Coordinator.connect` assigns `client.coordinator`, and
 * vgplot's `plot()` connects its marks synchronously, so the check is exact
 * right after the factory returns. Returns whether it warned.
 */
function warnOnCoordinatorMismatch(element: VgPlotElement, expected: Coordinator): boolean {
  const mismatched = plotMarks(element).filter((mark) => {
    const connected = connectedCoordinator(mark);
    return connected !== null && connected !== expected;
  });
  if (mismatched.length === 0) {
    return false;
  }
  console.warn(
    `[react-mosaic] useVgPlot: ${mismatched.length} of the plot's marks are ` +
      'connected to a different coordinator than the one this hook resolved ' +
      '(the `coordinator` option, else the nearest <MosaicProvider>, else the ' +
      'global coordinator), so they query a different database than the data ' +
      'hooks. Build the plot through the `api` passed to the factory — ' +
      '`useVgPlot((api) => api.plot(...))` — instead of the bare `vg.*` ' +
      'namespace, and call it as a method (a destructured `plot` loses its ' +
      'context). If the plot is deliberately bound to another coordinator, ' +
      'pass that coordinator as the `coordinator` option.',
  );
  return true;
}

function connectedCoordinator(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !('coordinator' in value)) {
    return null;
  }
  return value.coordinator ?? null;
}

function isClientLike(value: unknown): value is Pick<MosaicClient, 'destroy'> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'destroy' in value &&
    typeof (value as MosaicClient).destroy === 'function'
  );
}

/**
 * `process` is only typed here, never assumed: bundlers statically replace
 * `process.env.NODE_ENV` (so production builds drop the dev warning), and in
 * an environment with neither a bundler define nor a `process` global the
 * lookup throws and the build counts as development.
 */
declare const process: { env: Record<string, string | undefined> };

function isProductionBuild(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}
