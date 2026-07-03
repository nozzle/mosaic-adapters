---
'@nozzleio/mosaic-tanstack-table-core': minor
---

**BREAKING — bridge re-cut over FilterSet.** The column-filter bridge is now a thin `columnFilters` → `FilterSpec` translator; the target `FilterSet` owns all clause machinery (publishing, per-spec sources, targets, external-clear detection).

- `FilterBridgeOptions.selection` is replaced by `set: FilterSet`.
- New `idPrefix` option (spec id = `` `${idPrefix}${columnId}` ``) and per-column `label`/`target` on `FilterBridgeColumn`.
- `onExternalClear` is replaced by `onExternalChange`, which now reports the full rebuilt `ColumnFiltersState` for both external spec removals and pre-mount hydrated specs, so consumers can adopt persisted state.
- Internal clause construction, `BridgeClauseSource` bookkeeping, and the Selection value-listener plumbing are deleted — the six clause kinds and their TanStack-value normalization are unchanged.

See `docs/tanstack/integration.md`.
