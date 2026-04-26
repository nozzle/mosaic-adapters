# Phase 4: Table Metadata Compatibility and Projection Planning

## Goal

Extend the existing `MosaicDataTable` architecture to support richer metadata and projection planning while preserving current public APIs.

## Non-Goals

- Do not add row pinning or pinned row queries yet.
- Do not rewrite `MosaicDataTable` as a new class.
- Do not remove `meta.mosaicDataTable`.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- `packages/mosaic-tanstack-table-core/src/data-table.ts`
- `packages/mosaic-tanstack-table-core/src/table-core.ts`
- `packages/mosaic-tanstack-table-core/src/types/general.ts`
- `packages/mosaic-tanstack-table-core/src/query/column-mapper.ts`
- `packages/mosaic-tanstack-table-core/src/query/query-builder.ts`
- `packages/mosaic-tanstack-table-core/tests/data-table.test.ts`
- `docs/react/simple-usage.md`

Useful design context, if available:

- `.opencode-temp/mosaic-learning/headless-data-table-core-tanstack-design.md`

## Metadata Decisions

Support both namespaces:

```ts
columnDef.meta.mosaicDataTable;
columnDef.meta.mosaic;
```

Compatibility rule:

- Existing `meta.mosaicDataTable` remains supported.
- New docs/examples should prefer `meta.mosaic`.
- If both are present, phase implementation must document and test precedence. Prefer explicit `meta.mosaic` when both configure the same concept, unless this creates a compatibility issue.

Target additive metadata:

```ts
type MosaicColumnMeta = {
  fields?: Array<string>;
  sortBy?: string;
  filterBy?: string;
  facetBy?: string;
  globalFilterBy?: Array<string>;
  sqlColumn?: string; // legacy-compatible
  sqlFilterType?: string; // legacy-compatible
  facet?: string;
  facetSortMode?: 'alpha' | 'count';
};
```

## Implementation Tasks

- Add metadata reader helpers so code does not manually inspect only `meta.mosaicDataTable`.
- Extend type augmentation to include `meta.mosaic`.
- Extend `ColumnMapper` to understand:
  - legacy `mapping`
  - legacy `meta.mosaicDataTable.sqlColumn`
  - new `meta.mosaic.fields`
  - new `meta.mosaic.sortBy/filterBy/facetBy/globalFilterBy`
- Add projection planning:
  - visible column fields
  - declared metadata fields
  - row identity fields if configured
  - active sorting/filtering fields
  - fields required for Mosaic selection publishing
- Add global filter SQL compilation using configured global filter fields.
- Preserve existing SQL output for old mappings unless new metadata is used.
- Decide whether to fix `totalRowsColumnName` in this phase. Current tests characterize it as hard-coded. If fixed, update tests and document as bug fix.

## Likely Files

- `packages/mosaic-tanstack-table-core/src/query/column-mapper.ts`
- `packages/mosaic-tanstack-table-core/src/query/query-builder.ts`
- `packages/mosaic-tanstack-table-core/src/query/projection-planner.ts`
- `packages/mosaic-tanstack-table-core/src/query/column-meta.ts`
- `packages/mosaic-tanstack-table-core/src/types/general.ts`
- `packages/mosaic-tanstack-table-core/src/table-core.ts`
- `packages/mosaic-tanstack-table-core/tests/data-table.test.ts`
- `docs/react/simple-usage.md`
- `docs/core/concepts.md` if metadata docs are touched

## Tests

Add or update tests for:

- current `mapping` behavior still works
- current `meta.mosaicDataTable` behavior still works
- new `meta.mosaic` behavior works
- precedence when both namespaces exist
- `fields` projects hidden/custom-cell dependencies
- sorting uses `sortBy`
- filtering uses `filterBy`
- faceting uses `facetBy`
- global filter compiles across configured fields
- column visibility affects projection without starving active sort/filter fields
- `totalRowsColumnName` behavior, whether preserved or fixed

## Validation

Run:

```sh
pnpm test:format
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:types
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:build
```

Run React package checks if type augmentation changes affect it.

## Handoff Update

Before committing, append a "Phase 4 Handoff" section to this file with:

- files changed
- metadata precedence decision
- projection rules implemented
- tests added/updated
- validation commands and results
- known risks or follow-ups for Phase 5

## Commit Checklist

- Working tree contains only Phase 4 changes plus Phase 4 handoff.
- Existing table APIs remain compatible.
- Both metadata namespaces are tested.
- Commit message example: `feat(table): support mosaic column metadata projections`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 4 from .opencode/plans/mosaic-implementation/phase-04-table-metadata-projection.md.

Assume Phases 1-3 are complete. Extend the existing MosaicDataTable implementation with metadata compatibility for meta.mosaicDataTable and meta.mosaic, projection planning, and global filter compilation. Do not add row pinning or rewrite the table core. Preserve existing public APIs. Use rg first for code search and read existing tests before editing. Run the phase validation commands before final handoff. Make one commit for the phase if validation passes.
```

## Phase 4 Handoff

Files changed:

- `packages/mosaic-tanstack-table-core/src/types/general.ts`
- `packages/mosaic-tanstack-table-core/src/query/column-meta.ts`
- `packages/mosaic-tanstack-table-core/src/query/projection-planner.ts`
- `packages/mosaic-tanstack-table-core/src/query/column-mapper.ts`
- `packages/mosaic-tanstack-table-core/src/query/query-builder.ts`
- `packages/mosaic-tanstack-table-core/src/data-table.ts`
- `packages/mosaic-tanstack-table-core/src/sidecar-manager.ts`
- `packages/mosaic-tanstack-table-core/tests/data-table.test.ts`
- `docs/core/concepts.md`
- `docs/react/simple-usage.md`

Metadata precedence decision:

- `meta.mosaicDataTable` remains supported.
- `meta.mosaic` is the preferred namespace and wins over
  `meta.mosaicDataTable` when both configure the same metadata field.
- Existing `mapping` still wins for the legacy primary SQL column mapping to
  preserve compatibility. Operation-specific metadata (`sortBy`, `filterBy`,
  `facetBy`, `globalFilterBy`) can override the SQL field used for that
  operation.

Projection rules implemented:

- Query projection now includes visible column SQL fields.
- Visible columns also project declared `meta.mosaic.fields`, supporting
  accessor/custom-cell dependencies.
- Active sorting projects `sortBy` fields.
- Active column filtering projects and filters against `filterBy` fields.
- Active global filtering projects and compiles predicates across
  `globalFilterBy` fields.
- Configured row selection columns are projected as row identity fields.
- Hidden columns are omitted from projection unless needed by active
  sort/filter/global-filter or row-selection rules.
- `facetBy` is used for sidecar facet queries.
- `totalRowsColumnName` behavior was preserved as characterized; it was not
  fixed in this phase.

Tests added/updated:

- Legacy `meta.mosaicDataTable` SQL mapping/filtering still works.
- `meta.mosaic` takes precedence over legacy metadata.
- Metadata fields are projected for visibility, sorting, filtering, global
  filtering, and row selection.
- `facetBy` drives sidecar facet SQL and respects count sorting.
- Existing mapping and `totalRowsColumnName` characterization tests remain.

Validation commands and results:

- `pnpm test:format` - passed.
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types` - passed.
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint` - passed.
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib` - passed, 8
  files and 108 tests.
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build` - passed.
- `pnpm --filter @nozzleio/mosaic-tanstack-react-table test:types` - passed.
- `pnpm --filter @nozzleio/mosaic-tanstack-react-table test:build` - passed.

Known risks or follow-ups for Phase 5:

- Stable field-based row identity and row pinning are still not implemented.
- Row selection continues to publish selected TanStack row IDs through the
  existing selection manager; Phase 5 should replace or augment this with the
  planned stable identity behavior.
- Additional metadata field aliases use the declared field string as the row
  alias. Nested dependency consumers should reference the projected field alias
  consistently.
