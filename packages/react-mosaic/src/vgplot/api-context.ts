import { coordinator as defaultCoordinator } from '@uwdata/mosaic-core';
import type { Coordinator } from '@uwdata/mosaic-core';
import { createAPIContext, namedPlots as defaultNamedPlots } from '@uwdata/vgplot';
import type * as vgplot from '@uwdata/vgplot';

type VgPlotModule = typeof vgplot;

/**
 * Exports of the `@uwdata/vgplot` module that are NOT part of the API context
 * object `createAPIContext()` returns. The context spreads the namespace of
 * vgplot's internal `api.js` (marks, attributes, interactors, legends, inputs,
 * layout, SQL helpers, `Param`/`Selection`, …); the package entry adds these
 * on top, and the context overrides `coordinator` with a bound getter.
 * Verified against @uwdata/vgplot v0.32 (`src/index.js`, `src/context.js`).
 */
type ModuleOnlyExport =
  | 'Coordinator'
  | 'MosaicClient'
  | 'RestConnector'
  | 'SocketConnector'
  | 'DuckDBWASMConnector'
  | 'restConnector'
  | 'socketConnector'
  | 'wasmConnector'
  | 'namedPlots'
  | 'requestNamedPlot'
  | 'connect'
  | 'createAPIContext'
  | 'attributeDirectives'
  | 'markDirectives'
  | 'interactorDirectives'
  | 'legendDirectives'
  | 'coordinator';

/** The registry vgplot uses to resolve plots referenced by name (e.g. legends' `for`). */
export type VgPlotNamedPlots = VgPlotModule['namedPlots'];

/** The `context` an API context carries; vgplot's context-sensitive calls read it via `this`. */
export interface VgPlotApiContext {
  /** The coordinator `api.plot(...)` and the inputs (`api.menu(...)`, …) connect their clients to. */
  coordinator: Coordinator;
  /** The named-plot registry `api.name(...)` writes to and legends read from. */
  namedPlots: VgPlotNamedPlots;
}

/**
 * A typed vgplot API context, as returned by `createAPIContext({ coordinator })`
 * (which upstream types as `any`). It is the vgplot namespace with its
 * context-sensitive calls bound to {@link VgPlotApiContext.coordinator}.
 *
 * Call its functions as methods — `api.plot(...)`, not a destructured
 * `const { plot } = api` — because vgplot resolves the context from `this`; a
 * detached call falls back to the upstream global coordinator.
 */
export interface VgPlotApi extends Omit<VgPlotModule, ModuleOnlyExport> {
  /** Returns the coordinator this API context is bound to. */
  coordinator: () => Coordinator;
  context: VgPlotApiContext;
}

/**
 * One API context per coordinator, shared by every `useVgPlot` on it — so
 * cross-plot naming (`api.name('a')` in one plot, a legend `for: 'a'` in
 * another) resolves through a single `namedPlots` registry. Weakly keyed, so a
 * discarded coordinator releases its context.
 */
const apiContexts = new WeakMap<Coordinator, VgPlotApi>();

/**
 * Get (creating on first use) the shared vgplot API context bound to
 * `coordinator`.
 *
 * For upstream Mosaic's global coordinator the context reuses vgplot's global
 * `namedPlots` registry, so plots built through the context and plots built
 * with the bare `vg.*` namespace still see each other's names — exactly as two
 * bare-namespace plots do. Any other coordinator gets a fresh registry, which
 * is `createAPIContext`'s own default.
 */
export function getVgPlotApi(coordinator: Coordinator): VgPlotApi {
  const cached = apiContexts.get(coordinator);
  if (cached !== undefined) {
    return cached;
  }
  // `defaultCoordinator()` lazily creates upstream's global singleton on its
  // first call. That only happens once per new coordinator (cache misses), and
  // the instance is idle until something connects to it; mosaic-core exposes no
  // way to peek at the singleton without creating it.
  const isGlobal = coordinator === defaultCoordinator();
  const api: VgPlotApi = isGlobal
    ? createAPIContext({ coordinator, namedPlots: defaultNamedPlots })
    : createAPIContext({ coordinator });
  apiContexts.set(coordinator, api);
  return api;
}
