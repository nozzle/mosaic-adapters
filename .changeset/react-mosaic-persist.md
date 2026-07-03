---
'@nozzleio/react-mosaic': minor
---

**Contains breaking changes (0.x convention).** `persist` passes through `useMosaicFacet`, `useMosaicHistogram`, and `useMosaicRows` as a structural option — a new persister identity is a new storage location, so keep it stable (module scope or `useMemo`) or the client recreates every render.

- Breaking: scope-level filter persistence is removed — `FilterScopePersister`, `FilterScopePersistenceContext`, `FilterScopePersistenceWriteContext`, `createFilterScopePersistenceContext`, `createSparseFilterScopeSnapshot`, and the `persister` option on `useMosaicFilters` are gone. Per-binding persisters (`useFilterBinding({ persister })`) cover the use case.
- Breaking: `FilterBindingPersister` is re-typed as `Persister<FilterBindingState, FilterBindingPersistenceContext>` (the new core contract). The write reason `'apply'` is renamed to `'update'`; `FilterPersistenceWriteReason` is now an alias of the core's `PersisterWriteReason`.

See `docs/core/filter-builder.md` and `docs/react/hooks.md`.
