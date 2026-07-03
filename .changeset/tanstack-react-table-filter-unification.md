---
'@nozzleio/mosaic-tanstack-react-table': minor
---

**BREAKING — follows the glue-core bridge re-cut.** `useTanStackFilterBridge` carries the same option changes as `@nozzleio/mosaic-tanstack-table-core`.

- `selection` → `set: FilterSet`; new `idPrefix` and per-column `label`/`target`.
- `onExternalClear` → `onExternalChange`, reporting rebuilt `ColumnFiltersState` for external removals and hydration adoption.
- `@nozzleio/mosaic-core` moves from a dev dependency to a runtime `dependency`.

See `docs/tanstack/integration.md`.
