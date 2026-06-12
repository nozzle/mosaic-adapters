---
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

feat: subquery membership filters (`column [NOT] IN (SELECT ...)`)

- `buildSubqueryPredicate` / `normalizeSubqueryFilterQuery` build IN-subquery
  predicates from mosaic-sql queries; `createSubqueryClause` publishes them as
  Selection clauses that never carry optimizer `meta`
- filter-builder definitions accept a `subquery` factory: the predicate is
  rebuilt from the serializable binding state, so bindings, facets, and
  persistence work unchanged; runtimes accept a `context` Selection so
  factories can embed sibling-filter predicates, with automatic, convergent
  rebuilds on context changes (`reapplyCommittedFilterSelection`)
- `MosaicFilter` / `useMosaicTableFilter` gain a `SUBQUERY` mode with a
  type-required `subquery` factory option
