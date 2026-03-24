# `@nozzleio/mosaic-tanstack-react-table` cleanup summary

## Cleanup changes made

- Tightened the root export surface to React-facing hooks, providers, and curated table types.
- Removed mixed root value re-exports for non-React helpers and controllers.
- Added adapter-owned subpath exports so consumers still install only `@nozzleio/mosaic-tanstack-react-table`:
  - `@nozzleio/mosaic-tanstack-react-table/helpers`
  - `@nozzleio/mosaic-tanstack-react-table/controllers`
  - `@nozzleio/mosaic-tanstack-react-table/debug`
- Reworked `useMosaicReactTable` so the hook owns coordinator normalization and uses consistent connect/disconnect semantics via `enabled`.
- Reworked `useMosaicTableFacetMenu` to match the same lifecycle pattern:
  - normalized coordinator and `enabled`
  - disconnect while disabled
  - explicit `clear`
  - `select` now performs real single-select behavior instead of aliasing `toggle`
- Narrowed `useMosaicTableFilter` to the filter modes the runtime actually supports:
  - `TEXT`
  - `MATCH`
  - `SELECT`
  - `DATE_RANGE`
  - `RANGE`
- Reworked `useMosaicHistogram` around an explicit React state contract:
  - `bins`
  - `loading`
  - `error`
  - `stats`
  - `client`
  - stable client updates for coordinator and step changes
  - cleared stale histogram state while disabled
- Narrowed `useFilterRegistry()` to a React-facing action contract instead of exposing the raw core registry instance.
- Hardened `useRegisterFilterSource` so fresh metadata object identities do not cause re-registration churn or render loops.
- Added publication metadata and a package-local `README.md`.

## Tests added or updated

- Expanded `tests/public-api.test.ts` to lock:
  - the cleaned root export surface
  - the new adapter subpaths
  - narrowed hook type contracts
- Added `tests/hooks.test.tsx` covering:
  - `useMosaicReactTable` lifecycle and coordinator normalization
  - `enabled` and disabled behavior for table and facet hooks
  - facet state propagation and hook method contracts
  - filter hook instance stability and disposal
  - histogram loading, step updates, error handling, and disabled-state clearing
- Added `tests/filter-registry.test.tsx` covering:
  - active-filter registration
  - filter removal
  - group clearing
  - narrowed registry action usage

## Export and API decisions implemented

- Kept the package root intentional and React-oriented.
- Did not restore broad core value re-exports at the root.
- Preserved single-package consumer ergonomics by publishing non-React utilities from adapter-owned subpaths instead of requiring direct `@nozzleio/mosaic-tanstack-table-core` installation in app code.
- Kept grouped table types on the adapter root as part of the intentional table-facing type surface.
- Treated moved active-filter APIs as intentional table-package surface and cleaned them up here.

## Follow-up notes for cross-package alignment

- If other wrappers need the same “single package install, intentional root” model, mirror this pattern with explicit subpaths instead of broad root re-exports.
- `@nozzleio/mosaic-tanstack-table-core` still owns the underlying controllers and helpers; the adapter subpaths are boundary shims, not new implementations.
- The trimmed example still has a pre-existing lint warning in `examples/react/trimmed/src/tanstack-table.d.ts` for an unused generic.
- No `test:e2e` run was added in this pass; validation followed the prompt’s required commands.
