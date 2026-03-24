# `@nozzleio/mosaic-tanstack-table-core` types and API pass

## Type-safety improvements made

- Replaced the facet registry’s loose `Record<string, FacetStrategy<any, any>>` contract with a keyed `FacetStrategyMap` derived from `MosaicFacetRegistry`.
- Made `StrategyRegistry` key-aware, so `get`, `register`, and `unregister` preserve the strategy type for the requested key instead of collapsing everything to `any`.
- Tightened `MosaicDataTableOptions['facetStrategies']` to `Partial<FacetStrategyMap>`.
- Narrowed `MosaicDataTable.requestFacet` and the TanStack table augmentation to no-input facet keys only (`unique`, `minmax`, `totalCount` by default). This prevents accidentally calling the convenience API with input-requiring strategies such as `histogram`.
- Reworked the sidecar contract so `SidecarClient` carries explicit `query` runtime options instead of the previous nested `options` workaround. `createTypedSidecarClient` now feeds strategy options into `query.options` without `as any`.
- Removed `any`-based `Selection` handling in `AggregationBridge` and `MosaicFilterRegistry` by using Mosaic’s exported `ClauseSource`, `SelectionClause`, and `selection.clauses` types directly.
- Tightened `FilterInput['CONDITION']` so `value`/`valueTo` use SQL-compatible primitives instead of `any`.
- Removed the `any` escape hatch from `MosaicFilter`’s `apply`/`generatePredicate` path and from `MosaicSelectionManager`’s predicate generation.
- Replaced several loose object traversals with typed helpers for nested facet/filter value access.
- Added `tests/public-api.test.ts` to lock the curated root export surface and the new typed facet/sidecar contracts.

## Remaining unavoidable type escapes and why

- `src/grouped/feature.ts`
  - `row.original` still needs a cast to `FlatGroupedRow`.
  - Reason: TanStack’s `Row<TData>` type does not encode the synthetic grouped-row shape injected by server-side grouping.
- `src/internal/data-table/grouped-controller.ts`
  - `ColumnDef<TData, any>` and grouped row casts remain around auto-generated leaf columns and grouped row metadata.
  - Reason: TanStack’s column value generic is erased in the dynamic leaf-column path, and grouped rows are materialized at runtime from server responses.
- `src/query/filter-factory.ts`
  - The date-range path still contains `unknown as Date` casts after runtime `instanceof Date` checks.
  - Reason: TypeScript does not preserve the narrowed tuple element type cleanly across the current coercion branches.

## Public API and export decisions

### Root exports kept intentional

- `MosaicDataTable`
- `createMosaicDataTableClient`
- `MosaicFacetMenu`
- `MosaicFilter`
- `AggregationBridge`
- `HistogramController`
- `createMosaicMapping`
- `createMosaicColumnHelper`
- public option/store/type exports from `src/types`
- `logger`
- validation helpers re-exported via `schema`
- grouped public row/types (`grouped/types`)

### Removed from the root export surface

- `MosaicFilterRegistry`
- grouped query/arrow helpers
- `createTypedSidecarClient`
- `SidecarClient`
- `SidecarManager`
- `StrategyRegistry`
- low-level filter-strategy registry plumbing
- `SqlIdentifier`
- `selection-manager` / `selection-utils`
- package-internal constants

### New explicit subpath exports

- `@nozzleio/mosaic-tanstack-table-core/filter-registry`
  - `MosaicFilterRegistry`, `ActiveFilter`, `SelectionRegistration`
- `@nozzleio/mosaic-tanstack-table-core/grouped`
  - grouped query helpers, grouped feature, grouped row/types, Arrow helpers
- `@nozzleio/mosaic-tanstack-table-core/sidecar`
  - `createTypedSidecarClient`, `SidecarClient`, sidecar config/query types

### Related wrapper-package changes

- `@nozzleio/mosaic-tanstack-react-table` no longer re-exports the entire core package wholesale.
- `@nozzleio/react-mosaic` now imports filter-registry APIs from the new `filter-registry` subpath.

## Migration notes for breaking changes

1. Filter registry imports must move from the root:

```ts
import {
  MosaicFilterRegistry,
  type ActiveFilter,
  type SelectionRegistration,
} from '@nozzleio/mosaic-tanstack-table-core/filter-registry';
```

2. Grouped helper imports must move from the root:

```ts
import {
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
  buildGroupedSelectionPredicate,
  buildGroupedMultiSelectionPredicate,
  arrowTableToObjects,
} from '@nozzleio/mosaic-tanstack-table-core/grouped';
```

3. Typed sidecar helpers must move from the root:

```ts
import { createTypedSidecarClient } from '@nozzleio/mosaic-tanstack-table-core/sidecar';
```

4. `requestFacet(columnId, type)` is now intentionally limited to no-input facet keys. Input-requiring strategies such as `histogram` should use `createTypedSidecarClient(HistogramStrategy)` instead of `requestFacet`.

## Validation

- `pnpm test:types`
- `pnpm test:lib`
- `pnpm test:lint`
- `pnpm test:build`
