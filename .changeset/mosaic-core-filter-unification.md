---
'@nozzleio/mosaic-core': minor
---

**BREAKING — filter-builder and filter-registry deleted.** Both subsystems are subsumed by `FilterSet` and the builder-registry kinds; chips now read the set directly.

- Removed: the entire `filter-builder/*` surface (`FilterDefinition`, value-kind and operator registries, `FilterBindingController`, condition-predicate helpers) and `filter-registry.ts` (`createFilterRegistry` and its chip types).
- Migrate declarative filter definitions and bindings to `createFilterSet` + builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`); migrate chip consumption to the set's derived chips.
- `sql-access` and `subquery-predicate` exports are unaffected (relocated in e5b3941, unchanged here).

See `docs/core/filter-set.md`.
