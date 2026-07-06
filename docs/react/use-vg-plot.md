# useVgPlot

vgplot interop is first-class and permanent: vgplot marks are MosaicClients on the same coordinator, so a vgplot chart handed the page Selection cross-filters with every data client for free. `useVgPlot` is thin sugar that mounts a vgplot element and disconnects its mark clients on unmount — nothing else sits between vgplot and the page.

```tsx
import * as vg from '@uwdata/vgplot';
import { useVgPlot } from '@nozzleio/react-mosaic';

function WeightHeightScatter() {
  const plotRef = useVgPlot(() =>
    vg.plot(
      vg.dot(vg.from('athletes', { filterBy: $page }), {
        x: 'weight',
        y: 'height',
        fill: 'sex',
      }),
      vg.intervalXY({ as: $page }),
    ),
  );
  return <div ref={plotRef} />;
}
```

Semantics:

- The factory is held by latest-ref and invoked on every (re)build; the returned element is appended to the ref'd node.
- On detach the plot's mark clients are disconnected from their coordinator and the element is removed. StrictMode's simulated remount builds a fresh plot.
- Bare `vg.plot(...)` connects marks to the upstream **global** coordinator. To target a specific coordinator (e.g. the one in `MosaicProvider`), build the plot through `createAPIContext({ coordinator })` — see the [connector lifecycle recipe](./connector-lifecycle.md#the-vgplot-gotcha-bind-plots-to-the-provided-coordinator) for the full pattern.
- Interactors attach DOM/Selection listeners that upstream vgplot provides no teardown for; the hook disconnects the _clients_ (marks), which stops all querying.

## `deps` — rebuild when captured identities change

A plot publishes into whatever Selection instances its factory closed over at build time. Module-scope Selections (like the example above) never change identity and need nothing. But Selections owned by a React lifecycle — most notably ones resolved off a [`useTopology`](./topology.md) topology — can be replaced after the plot is built: on StrictMode's simulated remount the plot re-attaches _before_ the revived topology re-renders, leaving the plot bound to a destroyed topology's Selection. It keeps filtering (relays survive) but nothing observes it — `activeClauses`, chip bars, and `reset()` go blind to it.

Pass every such value in the second argument; the plot is torn down and rebuilt with the latest factory whenever one changes identity (`Object.is`):

```tsx
const $brush = useMosaicSelectionRef('volumeBrush');
const $context = useMosaicSelectionRef('volumeBrushFilterBy');
const plotRef = useVgPlot(
  () =>
    vg.plot(
      vg.rectY(vg.from('questions', { filterBy: $context }), {
        x: vg.bin('search_volume'),
        y: vg.count(),
      }),
      vg.intervalX({ as: $brush }),
    ),
  [$brush, $context],
);
```

A rebuild constructs fresh interactors, so un-committed visual state (e.g. a brush overlay) does not carry over — acceptable for the identity-change case, which happens before the user has interacted.

## Interactors don't observe external clears

An interval interactor repaints its brush overlay from its own last-published value, never from the Selection — so a clause cleared from outside (a chip's ✕, a page-wide `topology.reset()`) resets the data but leaves the overlay painted. Sync it yourself: when the observed clause disappears, call the interactor's `reset()` (clears both its value and the overlay). See the volume-brush panel in `examples/react/nozzle-paa` for the pattern.
