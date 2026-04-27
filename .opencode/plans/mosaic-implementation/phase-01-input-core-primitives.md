# Phase 1: Input Core Primitives

## Goal

Create shared, framework-agnostic primitives for headless Mosaic inputs. This phase should not implement Text or Select controls yet.

## Non-Goals

- Do not add public Text/Select APIs yet.
- Do not change data-table behavior.
- Do not add docs examples beyond minimal API notes if needed for exports.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- `packages/mosaic-tanstack-table-core/src/client-utils.ts`
- `packages/mosaic-tanstack-table-core/src/facet-menu.ts`
- `packages/mosaic-tanstack-table-core/src/filter-builder/binding-controller.ts`
- `packages/mosaic-tanstack-table-core/src/index.ts`
- `packages/mosaic-tanstack-table-core/package.json`

Useful design context, if available:

- `.opencode-temp/mosaic-learning/vgplot-inputs-learning.md`
- `.opencode-temp/mosaic-learning/headless-input-core-react-design.md`

## Implementation Tasks

- Add `packages/mosaic-tanstack-table-core/src/input-core/`.
- Add a `BaseInputCore<TState, TConfig>` that:
  - extends `MosaicClient`
  - owns a TanStack `Store`
  - uses the existing lifecycle style from `createLifecycleManager`
  - supports `connect`, `disconnect`, `destroy`, `setCoordinator`, and `updateOptions` or `setConfig`
  - keeps render-relevant state in Store and runtime details in private fields
  - handles `filterBy` identity changes by reconnecting if already connected
  - handles `enabled: false` without executing queries
- Add shared guards/helpers for output targets:
  - distinguish `Selection` from scalar `Param`
  - remember that `Selection` extends `Param`
- Add subscription helpers for:
  - scalar `Param` value changes
  - `Param<string>` source changes
  - cleanup/dispose
- Add an `input-core` package sub-export in `packages/mosaic-tanstack-table-core/package.json`.
- Export only primitives intended for phase 2/3 from `packages/mosaic-tanstack-table-core/src/input-core/index.ts`.

## Likely Files

- `packages/mosaic-tanstack-table-core/src/input-core/base-input-core.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/guards.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/subscriptions.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/types.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/index.ts`
- `packages/mosaic-tanstack-table-core/package.json`
- `packages/mosaic-tanstack-table-core/vite.config.ts` if subpath build entries are explicit
- `packages/mosaic-tanstack-table-core/tests/input-core.test.ts`

## Tests

Add focused core tests for:

- initial Store creation
- connect/disconnect idempotency
- coordinator swap behavior
- `filterBy` identity change reconnect behavior
- `enabled: false` suppresses queries
- scalar Param subscription cleanup
- Param-backed source subscription cleanup
- `destroy()` is idempotent

## Validation

Run:

```sh
pnpm test:format
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build
```

## Handoff Update

Before committing, append a "Phase 1 Handoff" section to this file with:

- files changed
- public exports added
- tests added
- validation commands and results
- known risks or follow-ups for Phase 2

## Commit Checklist

- Working tree contains only Phase 1 changes.
- No Text/Select implementation slipped into this phase.
- Validation passed or failures are documented with clear reason.
- Commit message example: `feat(core): add shared Mosaic input primitives`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 1 from .opencode/plans/mosaic-implementation/phase-01-input-core-primitives.md.

Do not implement Text or Select yet. Add only the shared framework-agnostic input-core primitives, tests, package sub-export, and the Phase 1 handoff section. Preserve existing public APIs. Use rg first for code search and read existing tests before editing. Run the phase validation commands before final handoff. Make one commit for the phase if validation passes.
```

## Phase 1 Handoff

Files changed:

- `packages/mosaic-tanstack-table-core/src/input-core/base-input-core.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/guards.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/subscriptions.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/types.ts`
- `packages/mosaic-tanstack-table-core/src/input-core/index.ts`
- `packages/mosaic-tanstack-table-core/tests/input-core.test.ts`
- `packages/mosaic-tanstack-table-core/package.json`
- `packages/mosaic-tanstack-table-core/vite.config.ts`
- `.opencode/plans/mosaic-implementation/README.md`
- `.opencode/plans/mosaic-implementation/phase-01-input-core-primitives.md`

Public exports added:

- New package subpath export: `@nozzleio/mosaic-tanstack-table-core/input-core`
- `BaseInputCore`
- `isScalarParamTarget`
- `isSelectionTarget`
- `InputSubscriptionBag`
- `subscribeParamStringSource`
- `subscribeScalarParamValue`
- `BaseInputCoreConfig`
- `InputSubscriptionCleanup`
- `MosaicInputOutputTarget`
- `MosaicInputSource`

Tests added:

- `packages/mosaic-tanstack-table-core/tests/input-core.test.ts`
- Covers initial Store creation, connect/disconnect idempotency, coordinator swaps, `filterBy` identity reconnects, `enabled: false` query suppression, scalar Param subscription cleanup, Param-backed source subscription cleanup, output target guards, and idempotent `destroy()`.

Validation:

- `pnpm test:format` - passed
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types` - passed
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint` - passed
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib` - passed
- `pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build` - passed

Known risks or follow-ups for Phase 2:

- `BaseInputCore` intentionally does not implement Text or Select behavior. Phase 2 should bind Text-specific output publishing, scalar Param synchronization, and Selection clause activation on top of these primitives.
- The README `Commit` column must be filled with the created commit hash after the Phase 1 commit exists.
