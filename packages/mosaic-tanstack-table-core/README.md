# `@nozzleio/mosaic-tanstack-table-core`

Framework-agnostic core APIs for the Mosaic TanStack table adapter.

This package is the headless foundation used by the React wrapper packages. The root export is curated for the stable table client, filter client, facet menu, mapping helpers, schema helpers, and grouped row types.

Low-level extension APIs are published from explicit subpaths:

- `@nozzleio/mosaic-tanstack-table-core/filter-registry`
- `@nozzleio/mosaic-tanstack-table-core/grouped`
- `@nozzleio/mosaic-tanstack-table-core/facet-strategies`
- `@nozzleio/mosaic-tanstack-table-core/sidecar`

React apps should usually import active-filter helpers from `@nozzleio/mosaic-tanstack-react-table` instead of consuming the headless filter registry directly.
