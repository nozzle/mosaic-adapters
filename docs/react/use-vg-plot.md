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

- The factory is held by latest-ref and invoked once per attach; the returned element is appended to the ref'd node.
- On detach the plot's mark clients are disconnected from their coordinator and the element is removed. StrictMode's simulated remount builds a fresh plot.
- Bare `vg.plot(...)` connects marks to the upstream **global** coordinator. To target a specific coordinator (e.g. the one in `MosaicProvider`), build the plot through `createAPIContext({ coordinator })`.
- Interactors attach DOM/Selection listeners that upstream vgplot provides no teardown for; the hook disconnects the _clients_ (marks), which stops all querying.
