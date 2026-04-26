# Phase 5: Table Row Identity, Pinning, and Race Protection

## Goal

Add advanced table behavior that depends on stable row identity and safer async query handling.

## Non-Goals

- Do not change input APIs.
- Do not rewrite grouped mode unless required for compatibility.
- Do not remove legacy row selection behavior.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- `.opencode/plans/mosaic-implementation/phase-04-table-metadata-projection.md`
- `packages/mosaic-tanstack-table-core/src/data-table.ts`
- `packages/mosaic-tanstack-table-core/src/internal/data-table/flat-table-options.ts`
- `packages/mosaic-tanstack-table-core/src/internal/data-table/flat-table-state.ts`
- `packages/mosaic-tanstack-table-core/src/internal/data-table/grouped-controller.ts`
- `packages/mosaic-tanstack-table-core/src/selection-manager.ts`
- `packages/mosaic-tanstack-table-core/src/sidecar-client.ts`
- `packages/mosaic-tanstack-table-core/src/sidecar-manager.ts`
- `packages/mosaic-tanstack-table-core/tests/data-table.test.ts`

Useful design context, if available:

- `.opencode-temp/mosaic-learning/vgplot-inputs-learning.md`
- `.opencode-temp/mosaic-learning/headless-data-table-core-tanstack-design.md`

## Row Identity Decision

For advanced table features, prefer stable field-based row identity.

Reasoning:

- TanStack row indexes are unstable under sorting, filtering, pagination, and virtualization.
- Mosaic selection predicates and pinned-row queries need database fields, not current page indexes.
- vgplot table selection used row-values via `clausePoints(...)`; keep this as a fallback mode, not the preferred advanced mode.

Additive API direction:

```ts
rowId?: string | Array<string>;
getRowId?: (row: Record<string, unknown>) => string;
rowSelectionMode?: 'row-id' | 'row-values';
```

Preserve current:

```ts
rowSelection: {
  selection: Selection;
  column: string;
  columnType?: ColumnType;
}
```

If possible, map current `rowSelection.column` to the new stable row-id path internally.

## Implementation Tasks

- Add stable row identity options without breaking current `rowSelection.column`.
- Configure TanStack `getRowId` when row identity is field-based.
- Ensure projection planner includes row identity fields.
- Add row pinning support:
  - store pinned row ids from TanStack row pinning state
  - query pinned rows separately by row id
  - keep pinned rows independent of current page/window
- Add request-id stale response protection for:
  - main row query
  - total count sidecar
  - facet sidecars
  - pinned row query
- Add optional table selection methods if not already present:
  - `hoverRow(row | null)`
  - `selectRow(row | null)`
  - `clearSelection()`
- Support `row-id` selection mode with `clausePoint`.
- Support `row-values` fallback with `clausePoints` or equivalent predicate.
- Audit grouped mode for row identity compatibility and document any deferred work.

## Likely Files

- `packages/mosaic-tanstack-table-core/src/types/general.ts`
- `packages/mosaic-tanstack-table-core/src/data-table.ts`
- `packages/mosaic-tanstack-table-core/src/internal/data-table/flat-table-options.ts`
- `packages/mosaic-tanstack-table-core/src/query/pinned-rows-query.ts`
- `packages/mosaic-tanstack-table-core/src/query/row-identity.ts`
- `packages/mosaic-tanstack-table-core/src/selection-manager.ts`
- `packages/mosaic-tanstack-table-core/src/sidecar-client.ts`
- `packages/mosaic-tanstack-table-core/src/sidecar-manager.ts`
- `packages/mosaic-tanstack-table-core/tests/data-table.test.ts`

## Tests

Add or update tests for:

- current row selection API remains compatible
- field-based `rowId` configures TanStack `getRowId`
- row selection after sorting/pagination uses stable row id values
- projection includes row id fields
- row pinning state triggers pinned row query
- pinned rows remain available when current page changes
- stale main row response is ignored after newer query starts
- stale facet/total count response is ignored
- stale pinned row response is ignored
- `row-values` fallback publishes a row-values predicate
- grouped mode either works or has a documented deferred test

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

Run React package tests if hook-facing types or table options changed.

## Handoff Update

Before committing, append a "Phase 5 Handoff" section to this file with:

- files changed
- row identity API implemented
- pinning behavior implemented or deferred
- race protection mechanism
- tests added/updated
- validation commands and results
- known risks or docs needed in Phase 6

## Commit Checklist

- Working tree contains only Phase 5 changes plus Phase 5 handoff.
- Legacy row selection behavior remains tested.
- New row identity behavior is explicit and documented.
- Commit message example: `feat(table): add stable row identity and pinned rows`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 5 from .opencode/plans/mosaic-implementation/phase-05-table-row-identity-pinning-race-protection.md.

Assume Phases 1-4 are complete. Add stable table row identity, row pinning query support, and stale response protection while preserving legacy row selection APIs. Do not change input APIs. Use rg first for code search and read existing tests before editing. Run the phase validation commands before final handoff. Make one commit for the phase if validation passes.
```
