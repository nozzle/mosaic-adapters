---
'@nozzleio/mosaic-core': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

Expose the rows client's row selection as state, and let the TanStack Table filter bridge be conditional or keep its filters applied after teardown.

- `RowsClientState` gains `selected`: the currently published row-selection tuples (aligned to `publish.select.columns`), `[]` when nothing is selected. It follows every change, including `selectRows`, `setSelectedValues`, persisted/FilterSet hydration, external clears and the destroy-time clear. It only notifies subscribers when the value actually changes.
- `setSelectedValues` now accepts readonly tuples, so `state.selected` can be replayed directly. The tuples are copied, not held.
- `FilterBridge.destroy()` accepts an optional `{ retainSpecs: true }` (new `FilterBridgeDestroyOptions` type) to leave every managed spec in the set instead of removing it. The default is unchanged: destroy removes the specs the bridge wrote.
- `useTanStackTableFilterBridge` accepts `set: undefined`, which makes the bridge inert (no bridge, no publishing, no `onExternalChange`). Switching a set to `undefined` tears the bridge down like an unmount. The new `retainSpecsOnUnmount` option (default `false`) keeps the managed specs in the set on teardown.
