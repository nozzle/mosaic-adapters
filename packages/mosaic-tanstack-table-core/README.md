# `@nozzleio/mosaic-tanstack-table-core`

Framework-agnostic headless APIs for Mosaic + TanStack Table integrations.

Use this package when you want the core table client, filter/facet clients, mapping helpers, or low-level extension points without the React wrappers. React apps will usually install `@nozzleio/mosaic-tanstack-react-table` instead and only reach for this package directly when they need headless or non-React integration work.

## Install

```bash
npm install @nozzleio/mosaic-tanstack-table-core
```

## Root exports

The package root is intentionally curated. Stable root exports include:

- `MosaicDataTable`
- `createMosaicDataTableClient`
- `MosaicFacetMenu`
- `MosaicFilter`
- `AggregationBridge`
- `HistogramController`
- `createMosaicMapping`
- `createMosaicColumnHelper`
- schema and validation helpers from `schema`
- public table, column, filter, and grouped-row types
- `logger`

```ts
import {
  createMosaicDataTableClient,
  createMosaicColumnHelper,
  createMosaicMapping,
  MosaicFilter,
  MosaicFacetMenu,
} from '@nozzleio/mosaic-tanstack-table-core';
```

## Published subpaths

Lower-level extension APIs live on explicit subpaths:

- `@nozzleio/mosaic-tanstack-table-core/filter-registry`
- `@nozzleio/mosaic-tanstack-table-core/grouped`
- `@nozzleio/mosaic-tanstack-table-core/facet-strategies`
- `@nozzleio/mosaic-tanstack-table-core/sidecar`

```ts
import { MosaicFilterRegistry } from '@nozzleio/mosaic-tanstack-table-core/filter-registry';
import { buildGroupedLevelQuery } from '@nozzleio/mosaic-tanstack-table-core/grouped';
import { HistogramStrategy } from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';
import { createTypedSidecarClient } from '@nozzleio/mosaic-tanstack-table-core/sidecar';
```

## Notes

- `requestFacet(columnId, type)` on `MosaicDataTable` is limited to the built-in no-input facet keys. For input-driven strategies such as histograms, use the `sidecar` subpath instead.
- React active-filter UI helpers do not live here. Import `MosaicFilterProvider`, `useFilterRegistry`, `useActiveFilters`, and `useRegisterFilterSource` from `@nozzleio/mosaic-tanstack-react-table`.
- Undocumented internal helpers are not part of the public root API even if they existed in earlier workspace builds.
