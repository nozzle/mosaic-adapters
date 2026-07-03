---
'@nozzleio/react-mosaic': minor
---

**BREAKING — filter-builder hooks deleted.** The per-binding hook surface is subsumed by the `FilterSet` hooks.

- Removed: `useFilterBinding`, `useMosaicFilters`, `useFilterFacet`, `useFilterBindingControllerState`, `useFilterChips`, and the `FilterBindingPersister` types.
- Migrate to `useFilterSetState` / `useFilterSetChips` over a `createFilterSet`, and `publish.into` on the facet, histogram, and rows client hooks for widget-to-set wiring.

See `docs/core/filter-set.md`.
