# `@nozzleio/mosaic-tanstack-react-table`

React-facing hooks and active-filter helpers for the Mosaic TanStack Table adapter.

Install this package alongside `@nozzleio/react-mosaic`. The table hooks consume the shared coordinator context from that package; the headless core package is pulled in as an implementation dependency and is not the main app-facing entrypoint.

## Install

```bash
npm install @nozzleio/mosaic-tanstack-react-table @nozzleio/react-mosaic @tanstack/react-table @uwdata/mosaic-core @uwdata/mosaic-sql react react-dom
```

## Root exports

The package root is intentionally React-oriented:

- `useMosaicReactTable`
- `useGroupedTableState`
- `useMosaicTableFacetMenu`
- `useMosaicTableFilter`
- `useMosaicHistogram`
- `MosaicFilterProvider`
- `useFilterRegistry`
- `useActiveFilters`
- `useRegisterFilterSource`
- curated table-facing types such as `MosaicDataTableOptions`, grouped row types, and histogram/filter hook types

```tsx
import {
  MosaicFilterProvider,
  useMosaicReactTable,
  useMosaicTableFacetMenu,
  useMosaicTableFilter,
} from '@nozzleio/mosaic-tanstack-react-table';
import { useMosaicSelection } from '@nozzleio/react-mosaic';
```

## Published subpaths

Non-React helpers stay available from adapter-owned subpaths:

- `@nozzleio/mosaic-tanstack-react-table/helpers`
- `@nozzleio/mosaic-tanstack-react-table/controllers`
- `@nozzleio/mosaic-tanstack-react-table/debug`

```ts
import {
  createMosaicColumnHelper,
  createMosaicMapping,
} from '@nozzleio/mosaic-tanstack-react-table/helpers';
import { AggregationBridge } from '@nozzleio/mosaic-tanstack-react-table/controllers';
import { logger } from '@nozzleio/mosaic-tanstack-react-table/debug';
```

## Notes

- `useFilterRegistry()` returns the narrowed React-facing action API, not the raw core `MosaicFilterRegistry` instance.
- `useRegisterFilterSource()` accepts `explodeArrayValues: true` when a selection stores scalar arrays and the active-filter UI should expose them as individually removable chips.
- `useMosaicTableFilter()` supports the runtime filter modes `TEXT`, `MATCH`, `SELECT`, `DATE_RANGE`, and `RANGE`.
- `useMosaicTableFacetMenu()` exposes `toggle()`, `select()`, `clear()`, and `loadMore()`. Use `select()` for single-select facet UI and `clear()` to reset a facet.
- This package does not re-export the full core package from the root. If you need headless-only APIs, import them from `@nozzleio/mosaic-tanstack-table-core` or its explicit subpaths.
