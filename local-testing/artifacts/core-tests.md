# `@nozzleio/mosaic-tanstack-table-core` test coverage summary

## New or expanded test areas

- Added `packages/mosaic-tanstack-table-core/tests/data-table.test.ts` as an integration-style characterization suite for `MosaicDataTable`.
- Replaced the placeholder smoke coverage with behavior tests that exercise:
  - flat query construction from TanStack state
  - `tableFilterSelection` mirroring
  - external filter lifecycle resets and requery behavior
  - row-selection predicate synchronization
  - sidecar facet query behavior and facet value storage
  - grouped-table root loading, child expansion, leaf loading, auto leaf columns, and collapse cleanup
  - current `totalRowsColumnName` handling

## Behaviors now protected

- Flat-table queries preserve current SQL-building behavior for mapped columns, range filters, primary filters, ordering, pagination offsets, and `window` total row mode.
- Internal column filters continue to be mirrored into `tableFilterSelection`, including the generated predicate.
- External `filterBy` updates continue to reset pagination to page 0 and trigger a requery.
- TanStack row-selection updates continue to publish Mosaic selection values and predicates through `MosaicSelectionManager`.
- Facet sidecars continue to exclude the facet’s own column filter from cascading filters while still applying other active table filters.
- Facet query results continue to be stored on the host table via `updateFacetValue`.
- Grouped mode continues to:
  - materialize root rows from the initial grouped query
  - lazily load child groups and leaf rows on expansion
  - auto-generate leaf column defs from the first leaf payload
  - expose leaf columns only after expanded leaf rows exist
  - clear expanded descendants when a parent collapses
  - clear descendant selection state on collapse using the current selection semantics
- `totalRowsMode: 'window'` continues to read totals from the hard-coded `__total_rows` field.

## Remaining hard-to-test behavior and why

- Real coordinator integration is still lightly covered. The new tests use a fake coordinator, so Mosaic preaggregation, request consolidation, and coordinator-managed selection groups are not exercised.
- Schema discovery through real `queryFieldInfo` queries is still mocked. That keeps tests deterministic, but it means inferred-column behavior against a real backend is not directly covered here.
- Sidecar lifecycle teardown is covered indirectly through behavior, not through direct assertions on internal sidecar instances, because those clients are intentionally encapsulated behind `SidecarManager`.
- Error-path logging and non-Arrow fallback handling are still thinly tested because they are mostly observable through logs rather than stable public state.

## Current ambiguities discovered during testing

- Mapped text and equality filters currently depend on primitive TanStack filter values (`'alex'`, `'active'`, etc.). Passing `{ mode: 'TEXT', value: 'alex' }` or similar objects does not follow the same path unless a strategy exists with that exact mode name.
- `totalRowsColumnName` remains typed and configurable in options, but runtime behavior still hard-codes `__total_rows` for both query generation and result parsing.
- Grouped collapse currently clears row-selection state by leaving the active selection value `undefined`, not by preserving an explicit `null` value for the table client.
