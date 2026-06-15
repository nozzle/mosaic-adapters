---
'@nozzleio/mosaic-tanstack-table-core': minor
---

feat: default `SUBQUERY` strategy for TanStack `columnFilters`

- ships a default `SUBQUERY` filter strategy that builds
  `column [NOT] IN (SELECT ...)` predicates without registering a custom
  strategy; the membership query comes from a `subquery` factory on the
  column's mapping config (`StrictSqlColumnConfig.subquery`) or mosaic meta
  (`MosaicColumnMeta.subquery`), resolved mapping-first
- the stored `columnFilters` value carries only the serializable params; the
  predicate is rebuilt on every query build, including the cascading
  facet/sidecar path (`getCascadingFilters`), so subquery filters narrow
  sibling facets like any other filter
- supports both the dynamic `{ mode: 'SUBQUERY', value }` input and a static
  `filterType`/`sqlFilterType: 'SUBQUERY'` with the raw params as the value
- adds the `ColumnSubqueryFactory` type export; subquery clauses never carry
  optimizer `meta`, so Mosaic uses the standard query path
