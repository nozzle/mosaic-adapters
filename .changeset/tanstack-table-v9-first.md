---
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

Reorient the TanStack Table glue to v9-first (#166). Public API unchanged — the
only TanStack types crossing it (`SortingState`, `PaginationState`,
`ColumnFiltersState`) are identical in v9, so no source changes were required.
TanStack moves from a regular dependency to a peerDependency matching what
consumers actually install: `@nozzleio/mosaic-tanstack-react-table` now peers on
`@tanstack/react-table` (`^9.0.0-beta.34`) and `@nozzleio/mosaic-tanstack-table-core`
peers on `@tanstack/table-core` (`^9.0.0-beta.34`, provided transitively by any
TanStack framework adapter). Verified against `@tanstack/table-core@9.0.0-beta.34`.
