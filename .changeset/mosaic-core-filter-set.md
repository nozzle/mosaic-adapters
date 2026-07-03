---
'@nozzleio/mosaic-core': minor
---

Adds `createFilterSet`, a page-level object that owns a set of serializable dashboard-filter intents (`FilterSpec`) and resolves each into per-target Selection clauses. Purely additive — no breaking changes.

- Builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`) resolve a spec into zero or more clause emissions; `conditionFilterKind(options)` and `subqueryFilterKind(build)` are factories for condition-style and `IN (SELECT ...)`-shaped kinds, and the registry is consumer-extensible via `FilterSetOptions.kinds`.
- Named target Selections (`FilterSetOptions.targets`) with WHERE/HAVING routing per emission, derived chips for an active-filter bar, and external-clear mirroring (chip bar / `selection.reset()` removes the owning spec).
- Subquery context rebuilds: an optional `context` Selection feeds `contextPredicate` into context-dependent kinds and triggers a microtask-debounced re-publish on change.
- Whole-set persistence via a single `Persister<FilterSpec[]>` entry (`FilterSetOptions.persist`); hydration replays each spec resiliently and never writes back.
- New `publish: { into, id }` form on the facet, histogram, and rows clients — an alternative to `publish: { as }` that routes a widget's interaction into a `FilterSet` instead of a raw Selection, preserving widget mirror and self-exclusion semantics.

See `docs/core/filter-set.md`.
