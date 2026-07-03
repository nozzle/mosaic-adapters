---
'@nozzleio/react-mosaic': minor
---

Adds `useFilterSetState` and `useFilterSetChips`, subscription hooks over a `FilterSet`'s `@tanstack/store` (whole state, and just the derived chip list). Additive — no breaking changes.

- The facet, histogram, and rows client hooks' structural keys now understand the `publish.into` form: a change of target `FilterSet`, spec `id`, `kind`, or `label` recreates the client, matching the existing `publish.as` identity rules.

See `docs/core/filter-set.md` and `docs/react/hooks.md`.
