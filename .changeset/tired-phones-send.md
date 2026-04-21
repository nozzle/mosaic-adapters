---
'@nozzleio/mosaic-tanstack-table-core': patch
---

fix(table-core): preserve row selection across remounted table clients

Restore TanStack rowSelection from the shared Mosaic Selection value instead
of only the current client-scoped value.

Before this change, row selection UI was hydrated from
selection.valueFor(client). That worked while the same table instance stayed
mounted, but failed when a table was unmounted and remounted as a different
client, such as when moving a widget into or out of fullscreen. In that
case, crossfiltering and predicates remained active, but the new table
instance lost its visual row-selection state because it had no source-scoped
selection value of its own.

This change adds shared selection hydration in the selection manager and uses
it when syncing rowSelection back into table state. That keeps visual row
selection consistent across multiple mounted clients and across remounts while
preserving the existing source-scoped update behavior for writes.

Also adds regression coverage for:

- hydrating row selection into a remounted client
- keeping row selection visuals in sync across two clients sharing one selection
