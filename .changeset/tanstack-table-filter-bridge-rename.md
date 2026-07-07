---
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

Rename the filter-bridge APIs to name TanStack Table explicitly (not the
umbrella "TanStack" brand):

- `@nozzleio/mosaic-tanstack-react-table`: `useTanStackFilterBridge` →
  `useTanStackTableFilterBridge` (and `UseTanStackFilterBridgeOptions` →
  `UseTanStackTableFilterBridgeOptions`). The old names remain as `@deprecated`
  aliases, so this is non-breaking — migrate at your convenience.
- `@nozzleio/mosaic-tanstack-table-core`: `createFilterBridge` →
  `createTanStackTableFilterBridge`. No alias is kept, so framework-agnostic
  consumers importing it directly must update the name.
