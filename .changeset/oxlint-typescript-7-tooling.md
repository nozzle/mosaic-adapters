---
'@nozzleio/mosaic-core': patch
'@nozzleio/mosaic-tanstack-table-core': patch
---

Refactor source for the move from ESLint to type-aware oxlint and TypeScript 7. There are no runtime or API changes, and the published type declarations are unchanged.

- `@nozzleio/mosaic-core`: the fire-and-forget query promises in the base client's coalesced flush and in `RowsClient.prefetch` are now explicitly discarded with `void`. A redundant `void` on the `skipSources` projection's `'value'` emit is removed.
- Both packages: lint annotations, plus formatting from Prettier 3.9.
