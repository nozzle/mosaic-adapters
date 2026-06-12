---
'@nozzleio/mosaic-tanstack-react-table': patch
'@nozzleio/mosaic-tanstack-table-core': patch
---

refactor(table-core,react-table): carve out clause construction and filter dispatch for subquery support

Stage 1 of subquery-filter support; no behavior changes.

- add clause-factory module (createValueClause/createClearClause) as the
  single construction point for Selection clauses, centralizing the
  clause meta policy ahead of meta-free subquery clauses
- route all selection.update sites in table-core through the factory
- export ResolvedFilter/StoredFilterValue(Mode)/FilterBuilderDataType
  from filter-builder types; make predicate dispatch and filter-client
  mode switches exhaustive (never guards)
- make stored-filter-value reads mode-aware: unknown future modes (e.g.
  SUBQUERY) hydrate as empty state instead of being coerced into
  condition values
- react-table: reuse createClearClause in filter-scope-hook; re-export
  the new filter-builder types
