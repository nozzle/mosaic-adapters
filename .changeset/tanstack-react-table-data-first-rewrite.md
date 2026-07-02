---
'@nozzleio/mosaic-tanstack-react-table': minor
---

**BREAKING — rebuilt.** `useMosaicReactTable` and the legacy hook surface are removed. This package is now a thin React wrapper over `@nozzleio/mosaic-tanstack-table-core`, which is a regular dependency whose full public API is re-exported here, so consumers install and import from this package alone.

- `useTanStackFilterBridge` — React binding around the glue core's `createFilterBridge`.
- Full re-export of the glue core (`sortingToOrderBy`, `paginationToWindow`, `createFilterBridge`, and the bridge types).

See `docs/tanstack/integration.md`.
