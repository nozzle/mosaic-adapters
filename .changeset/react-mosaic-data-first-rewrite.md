---
'@nozzleio/react-mosaic': minor
---

**BREAKING — rebuilt from scratch.** `@nozzleio/react-mosaic` is now a set of controlled-binding React hooks over `@nozzleio/mosaic-core`; the legacy provider, registry, and hook APIs are removed. The core is a regular dependency whose full public API is re-exported here (the `@tanstack/react-table` distribution model), so consumers install and import from this package alone.

- Provider and coordinator: `MosaicProvider`, `useMosaicCoordinator`.
- Data hooks over the core clients: `useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicSchema`, plus `useVgPlot`.
- Filter-builder bindings: `useMosaicFilters`, `useFilterBinding`, `useFilterFacet`, and `useFilterChips`.
- Topology and selection helpers: `useMosaicSelections`, `useCascadingContexts`, `useComposedSelection`, `useMosaicSelectionValue`.

See `docs/react/*`.
