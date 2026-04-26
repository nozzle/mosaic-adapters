# Phase 3: Select Input Core and React Binding

## Goal

Implement a headless Mosaic Select input core and React binding with required multi-select support.

## Non-Goals

- Do not change data-table metadata/projection behavior.
- Do not replace existing `MosaicFacetMenu`; reuse ideas where useful, but keep this API generic and `as`-based.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- `.opencode/plans/mosaic-implementation/phase-01-input-core-primitives.md`
- `.opencode/plans/mosaic-implementation/phase-02-text-input.md`
- `packages/mosaic-tanstack-table-core/src/facet-menu.ts`
- `packages/mosaic-tanstack-table-core/src/selection-manager.ts`
- `packages/mosaic-tanstack-react-table/src/facet-hook.ts`

Useful design context, if available:

- `.opencode-temp/mosaic-learning/vgplot-inputs-learning.md`
- `.opencode-temp/mosaic-learning/headless-input-core-react-design.md`

## Public API Shape

Core options should be close to:

```ts
type MosaicSelectOption<T = unknown> = T | { value: T; label?: string };

type MosaicSelectInputOptions<T = unknown> = {
  as: Param<T | Array<T> | null> | Selection;
  filterBy?: Selection;
  coordinator?: Coordinator;
  from?: string | Param<string>;
  column?: string;
  field?: string;
  options?: Array<MosaicSelectOption<T>>;
  format?: (value: T) => string;
  multiple?: boolean;
  listMatch?: string;
  includeAll?: boolean;
  enabled?: boolean;
};
```

Store state should be close to:

```ts
type MosaicSelectInputState<T = unknown> = {
  value: T | Array<T> | '' | null;
  options: Array<{ value: T | ''; label: string }>;
  pending: boolean;
  error: Error | null;
};
```

React API:

- `useMosaicSelectInput(options)`
- `MosaicSelect(props)` as a minimal native select component

## Implementation Tasks

- Add `SelectInputCore`.
- Support literal options and query-backed options.
- Support single-select and multi-select.
- Preserve non-string values by storing original option values and mapping DOM selected indexes/options back to Store options.
- Publish values to:
  - scalar `Param` as raw value, array, or null
  - `Selection` as `clausePoint`, multi-value equivalent, or `clauseList` for list-valued columns
- Synthetic All/clear should produce no active predicate for this source.
- Query-backed options should support dynamic `from`, `filterBy`, and optional array/list unnest behavior.
- Add `activate()` for selection preview.
- Add React hook and component under the existing `inputs` React sub-export.

## Multi-Select Semantics

Required behavior:

- `multiple: true` stores an array of selected original values.
- Empty array publishes null/no active predicate.
- `Param` output receives the selected array.
- `Selection` output should generate an `IN`/points-style predicate for scalar columns.
- For list-valued columns, use list membership semantics.

Preserve current `MosaicFacetMenu` behavior for existing APIs; this Select input is additive.

## Likely Files

- `packages/mosaic-tanstack-table-core/src/input-core/select-input-core.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/options.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/index.ts`
- `packages/mosaic-tanstack-react-table/src/inputs/select-input-hook.ts`
- `packages/mosaic-tanstack-react-table/src/inputs/select-input.tsx`
- `packages/mosaic-tanstack-react-table/src/inputs/index.ts`
- core and React tests

## Tests

Add focused tests for:

- literal option normalization
- number/boolean/date/object option values are preserved
- single-select Param output
- multi-select Param output
- single-select Selection output
- multi-select Selection output
- list-valued column Selection output
- All/clear clears predicate
- query-backed options use `from`, `column`, and `filterBy`
- dynamic `from` string and Param changes requery
- external Param updates update Store
- React native select maps selected indexes to original values
- React lifecycle connect/disconnect/config update

## Validation

Run:

```sh
pnpm test:format
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:types
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:lint
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:lib
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:build
```

## Handoff Update

Before committing, append a "Phase 3 Handoff" section to this file with:

- files changed
- public exports added
- tests added
- validation commands and results
- exact multi-select predicate semantics chosen
- known risks or follow-ups for Phase 4

## Commit Checklist

- Working tree contains only Phase 3 changes plus Phase 3 handoff.
- Existing `MosaicFacetMenu` behavior remains compatible.
- Multi-select support is covered by tests.
- Commit message example: `feat(inputs): add Mosaic select input`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 3 from .opencode/plans/mosaic-implementation/phase-03-select-input.md.

Assume Phases 1 and 2 are complete. Add Select input core with required multi-select support, React hook/component, tests, exports, and the Phase 3 handoff section. Do not change table metadata/projection behavior. Preserve existing public APIs. Use rg first for code search and read existing tests before editing. Run the phase validation commands before final handoff. Make one commit for the phase if validation passes.
```
