# Phase 2: Text Input Core and React Binding

## Goal

Implement a headless Mosaic Text input core and React binding using the primitives from Phase 1.

## Non-Goals

- Do not implement Select.
- Do not change data-table behavior.
- Do not add broad filter-builder changes.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- `.opencode/plans/mosaic-implementation/phase-01-input-core-primitives.md`
- `packages/mosaic-tanstack-table-core/src/input-core/`
- `packages/mosaic-tanstack-react-table/src/facet-hook.ts`
- `packages/mosaic-tanstack-react-table/src/filter-hook.ts`
- `packages/react-mosaic/src/context.tsx`

Useful design context, if available:

- `.opencode-temp/mosaic-learning/vgplot-inputs-learning.md`
- `.opencode-temp/mosaic-learning/headless-input-core-react-design.md`

## Public API Shape

Core options should be close to:

```ts
type MosaicTextInputOptions = {
  as: Param<string | null> | Selection;
  filterBy?: Selection;
  coordinator?: Coordinator;
  from?: string | Param<string>;
  column?: string;
  field?: string;
  match?: 'contains' | 'prefix' | 'suffix' | 'regexp';
  value?: string | null;
  enabled?: boolean;
};
```

Store state should be close to:

```ts
type MosaicTextInputState = {
  value: string;
  suggestions: Array<string>;
  pending: boolean;
  error: Error | null;
};
```

React API:

- `useMosaicTextInput(options)`
- `MosaicTextInput(props)` as a minimal native input component

## Implementation Tasks

- Add `TextInputCore`.
- Publish values to:
  - scalar `Param` as raw string or null
  - `Selection` as a text match clause with `source: this`
- Empty string should clear the active predicate for this source.
- Support `activate()` for selection preview without changing current value.
- If `from` and `column` are provided, query distinct suggestion values filtered by `filterBy`.
- Subscribe to external scalar Param changes and update Store.
- Subscribe to Param-backed `from` changes and requery.
- Add React hook and component under `packages/mosaic-tanstack-react-table/src/inputs/`.
- Add React sub-export `./inputs` if not already added.

## Likely Files

- `packages/mosaic-tanstack-table-core/src/input-core/text-input-core.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/index.ts`
- `packages/mosaic-tanstack-react-table/src/inputs/text-input-hook.ts`
- `packages/mosaic-tanstack-react-table/src/inputs/text-input.tsx`
- `packages/mosaic-tanstack-react-table/src/inputs/index.ts`
- `packages/mosaic-tanstack-react-table/package.json`
- `packages/mosaic-tanstack-react-table/vite.config.ts` if subpath build entries are explicit
- core and React tests

## Tests

Add focused tests for:

- scalar Param output
- Selection output uses a text match predicate and `source: core`
- empty string clears predicate
- external Param updates update Store value
- activation emits an activation clause without changing selection value
- query-backed suggestions include `filterBy`
- Param-backed `from` value change requeries
- React hook connects/disconnects and updates config
- native component calls core setter and activation handlers

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

Before committing, append a "Phase 2 Handoff" section to this file with:

- files changed
- public exports added
- tests added
- validation commands and results
- known risks or follow-ups for Phase 3

## Commit Checklist

- Working tree contains only Phase 2 changes plus Phase 2 handoff.
- No Select implementation slipped into this phase.
- Existing APIs remain compatible.
- Commit message example: `feat(inputs): add Mosaic text input`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 2 from .opencode/plans/mosaic-implementation/phase-02-text-input.md.

Assume Phase 1 is complete. Add the Text input core, React hook/component, tests, exports, and the Phase 2 handoff section. Do not implement Select or table changes. Preserve existing public APIs. Use rg first for code search and read existing tests before editing. Run the phase validation commands before final handoff. Make one commit for the phase if validation passes.
```
