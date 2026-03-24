# Cross-Package Alignment

## Final package responsibilities

- `@nozzleio/react-mosaic`
  - React-only coordinator, connector, and selection primitives.
  - Owns provider context and selection lifecycle helpers.
  - Does not own table-oriented active-filter APIs.
- `@nozzleio/mosaic-tanstack-react-table`
  - React-facing TanStack table hooks and active-filter helpers.
  - Depends on the shared React Mosaic context as a peer package instead of bundling its own copy.
  - Re-exports non-React helper/controller utilities from adapter-owned subpaths for single-package ergonomics.
- `@nozzleio/mosaic-tanstack-table-core`
  - Framework-agnostic headless engine.
  - Root export stays curated around stable table, filter, facet, mapping, schema, controller, logger, and grouped-row APIs.
  - Lower-level extension APIs live on explicit subpaths.

## Export alignment decisions

- Kept active-filter React APIs on `@nozzleio/mosaic-tanstack-react-table` root:
  - `MosaicFilterProvider`
  - `useFilterRegistry`
  - `useActiveFilters`
  - `useRegisterFilterSource`
- Kept `@nozzleio/react-mosaic` root focused on coordinator/selection React APIs plus `HttpArrowConnector`.
- Trimmed accidental root exports from `@nozzleio/mosaic-tanstack-table-core`:
  - removed broad root re-exports of low-level `utils`, `feature`, and facet strategy internals
  - kept `createMosaicColumnHelper` explicitly on the root because it is part of the curated consumer API
- Added an explicit core subpath for low-level facet strategies:
  - `@nozzleio/mosaic-tanstack-table-core/facet-strategies`
- Confirmed the existing explicit core subpaths remain the low-level extension points:
  - `@nozzleio/mosaic-tanstack-table-core/filter-registry`
  - `@nozzleio/mosaic-tanstack-table-core/grouped`
  - `@nozzleio/mosaic-tanstack-table-core/sidecar`
- Aligned the table package manifest so `@nozzleio/react-mosaic` is peer-owned for publication, avoiding duplicate React Mosaic context instances in consuming apps.
- Removed unused runtime dependencies from `@nozzleio/mosaic-tanstack-react-table` that did not belong to its published surface.
- Added missing publication metadata and a package README for `@nozzleio/mosaic-tanstack-table-core`.

## Breaking changes and migration notes

- `HistogramStrategy` is no longer available from the `@nozzleio/mosaic-tanstack-table-core` root.

```ts
import { HistogramStrategy } from '@nozzleio/mosaic-tanstack-table-core/facet-strategies';
```

- Undocumented low-level helpers previously leaked from the core root are now hidden. If you were importing accidental internals such as `createMosaicFeature`, `functionalUpdate`, or SQL helper utilities from the core root, move off those imports; they are no longer part of the published public API.
- `@nozzleio/mosaic-tanstack-react-table` now treats `@nozzleio/react-mosaic` as a peer dependency. React apps should continue installing both packages explicitly:

```bash
pnpm add @nozzleio/mosaic-tanstack-react-table @nozzleio/react-mosaic
```

## Any remaining publication risks

- `HttpArrowConnector` still ships from the `@nozzleio/react-mosaic` root even though it is not itself a React API. This is intentional for now, but it remains the main candidate for a future dedicated subpath or non-React package if the root surface needs further tightening.
- `@nozzleio/mosaic-tanstack-table-core/filter-registry` remains publishable for headless extension work. React consumers should avoid depending on it directly and should use the table package root APIs instead.
- The example app still excludes the core package from Vite prebundling for local workspace development. That is acceptable for the workspace, but it is not part of the npm consumer story.
