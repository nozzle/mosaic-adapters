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
