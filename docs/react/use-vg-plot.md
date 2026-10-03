# useVgPlot

vgplot interop is first-class and permanent: vgplot marks are MosaicClients on the same coordinator, so a vgplot chart handed the page Selection cross-filters with every data client for free. `useVgPlot` is thin sugar that mounts a vgplot element, hands its factory a vgplot API context bound to the right coordinator, and disconnects the plot's mark clients on unmount — nothing else sits between vgplot and the page.

The hook ships on its own entry point, `@nozzleio/react-mosaic/vgplot`, and `@uwdata/vgplot` is an optional peer dependency — install it only if you import that subpath. The main `@nozzleio/react-mosaic` entry never imports vgplot.

```tsx
import { useVgPlot } from '@nozzleio/react-mosaic/vgplot';

function WeightHeightScatter() {
  const plotRef = useVgPlot((api) =>
    api.plot(
      api.dot(api.from('athletes', { filterBy: $page }), {
        x: 'weight',
        y: 'height',
        fill: 'sex',
      }),
      api.intervalXY({ as: $page }),
    ),
  );
  return <div ref={plotRef} />;
}
```

Signature: `useVgPlot(factory, deps?, options?)`.

Semantics:

- The factory is held by latest-ref and invoked on every (re)build; the returned element is appended to the ref'd node.
- On detach the plot's mark clients are disconnected from their coordinator and the element is removed. StrictMode's simulated remount builds a fresh plot.
- Interactors attach DOM/Selection listeners that upstream vgplot provides no teardown for; the hook disconnects the _clients_ (marks), which stops all querying.

## The `api` factory argument

The factory receives `api`: the vgplot namespace bound to the hook's coordinator via upstream `createAPIContext({ coordinator })`. The coordinator resolves like every other hook's: the `coordinator` option → the nearest [`MosaicProvider`](./hooks.md#provider-setup) → upstream Mosaic's global coordinator (only when there is no provider; below a `coordinator={null}` boundary the hook throws unless given the option).

Why it matters: the bare `vg.plot(...)` namespace always connects marks to the upstream **global** coordinator. In an app that provides its own coordinator through `MosaicProvider`, a bare-namespace plot silently queries a different (possibly unloaded) database than the data hooks. Building through `api` puts the marks, interactors, and inputs on the same coordinator as everything else.

- **Typed.** `api` is a `VgPlotApi` (exported from `@nozzleio/react-mosaic/vgplot`, along with `VgPlotApiContext` and `VgPlotFactory`), so no `as unknown as` cast is needed — upstream types `createAPIContext()` as `any`. Its function signatures are vgplot's own published types.
- **Shared per coordinator.** The hook memoizes one context per coordinator (weakly keyed), so every plot on a coordinator shares a single named-plot registry and cross-plot naming (`api.name('a')` in one plot, a legend's `for: 'a'` in another) works. For the global coordinator the context reuses vgplot's global `namedPlots`, so plots built through `api` and through the bare namespace still see each other's names.
- **Rebuilds on a new coordinator.** The resolved coordinator is an implicit dep: when it changes (e.g. a reconnect hands `MosaicProvider` a new coordinator) the plot is torn down and rebuilt with a fresh `api`. You don't add `api` or the coordinator to `deps`.
- **Call it as a method.** vgplot resolves the context from `this`, so call `api.plot(...)`, `api.name(...)`, `api.menu(...)` — a destructured `const { plot } = api` falls back to the global coordinator.
- **Use one `api` for the whole plot.** The binding comes from the calls that read the context: `api.plot(...)` connects every mark of the plot to the bound coordinator, and inputs (`api.menu(...)`, …) connect themselves. Interactors and mark builders don't pick a coordinator on their own, so the one that matters is `plot`: `vg.plot(api.rectY(...))` still lands on the global coordinator. Building everything through `api` avoids the question.
- **Zero-argument factories keep working.** `useVgPlot(() => vg.plot(...))` is still accepted and behaves exactly as before in apps without a `MosaicProvider`, where the bare namespace and the hooks both land on the global coordinator. A factory that builds its own context with `createAPIContext({ coordinator })` also keeps working.

### Dev-mode coordinator mismatch warning

After each build the hook checks which coordinator the plot's marks connected to (`Coordinator.connect` records it on each mark). If any mark is on a different coordinator than the one the hook resolved — typically a bare `vg.plot(...)` below a `MosaicProvider` — it logs a single `[react-mosaic] useVgPlot: …` `console.warn` per hook instance. The check is skipped in production builds (`process.env.NODE_ENV === 'production'`) and covers the plot's marks only (the same `plot.marks` the hook disconnects on unmount), not standalone inputs.

If a plot is bound to another coordinator on purpose, say so with the `coordinator` option — `useVgPlot(factory, deps, { coordinator: other })` — which both binds `api` to it and makes it the coordinator the check expects.

## `deps` — rebuild when captured identities change

A plot publishes into whatever Selection instances its factory closed over at build time. Module-scope Selections (like the example above) never change identity and need nothing. But Selections owned by a React lifecycle — most notably ones resolved off a [`useTopology`](./topology.md) topology — can be replaced after the plot is built: on StrictMode's simulated remount the plot re-attaches _before_ the revived topology re-renders, leaving the plot bound to a destroyed topology's Selection. It keeps filtering (relays survive) but nothing observes it — `activeClauses`, chip bars, and `reset()` go blind to it.

Pass every such value in the second argument; the plot is torn down and rebuilt with the latest factory whenever one changes identity (`Object.is`). The resolved coordinator is tracked for you (see above):

```tsx
const $brush = useMosaicSelectionRef('volumeBrush');
const $context = useMosaicSelectionRef('volumeBrushFilterBy');
const plotRef = useVgPlot(
  (api) =>
    api.plot(
      api.rectY(api.from('questions', { filterBy: $context }), {
        x: api.bin('search_volume'),
        y: api.count(),
      }),
      api.intervalX({ as: $brush }),
    ),
  [$brush, $context],
);
```

A rebuild constructs fresh interactors, so un-committed visual state (e.g. a brush overlay) does not carry over — acceptable for the identity-change case, which happens before the user has interacted.

## Interactors don't observe external clears

An interval interactor repaints its brush overlay from its own last-published value, never from the Selection — so a clause cleared from outside (a chip's ✕, a page-wide `topology.reset()`) resets the data but leaves the overlay painted. Sync it yourself: when the observed clause disappears, call the interactor's `reset()` (clears both its value and the overlay). See the volume-brush panel in `examples/react/nozzle-paa` for the pattern.
