---
'@nozzleio/mosaic-tanstack-table-core': minor
---

**BREAKING — rebuilt as pure TanStack glue.** The monolithic `MosaicDataTable` adapter is removed; TanStack Table is now driven in fully manual mode by the consumer, and this package only supplies the translation layer between TanStack state and Mosaic clients/selections.

- State translators: `sortingToOrderBy` and `paginationToWindow`.
- `createFilterBridge` — publishes one clause per actively filtered column onto a Selection, with six declarative clause kinds (`equals`, `ilike`, `prefix`, `range`, `date-range`, `in`), struct-path columns (dotted ids → struct access), stable per-column clause sources, and an `onExternalClear` callback for reconciling external clause removals (chip-bar X, `selection.reset()`) back into TanStack `columnFilters`.

See `docs/tanstack/integration.md`.
