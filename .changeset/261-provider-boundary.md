---
'@nozzleio/react-mosaic': minor
---

Add explicit provider boundaries for subtrees that are not ready yet.

- `MosaicProvider` accepts `coordinator={null}`. Hooks that resolve their coordinator below it throw a clear `[react-mosaic]` error instead of silently falling back to a parent provider's coordinator or the upstream global one. An explicit `coordinator` hook option still wins, and a nested provider holding a coordinator re-opens resolution. With no provider at all, the upstream global coordinator remains the fallback, unchanged.
- `MosaicTopologyProvider` accepts `topology={null}`, which shadows any outer provider so topology hooks below it throw the usual "no provider" error.
- `useFilterSetState`, `useFilterSetChips`, and `useTopologyActiveClauses` accept `null` / `undefined` and return a stable, frozen empty state without subscribing.
