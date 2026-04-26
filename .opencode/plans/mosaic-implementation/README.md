# Mosaic Inputs and Advanced Table Implementation Plan

## Purpose

This directory contains the phased implementation plan for adding headless Mosaic Text and Select inputs, then closing advanced Mosaic/TanStack data-table gaps.

The plan is intentionally split so each phase can be implemented in a fresh conversation without relying on a single long-running context window.

## Completion Status

This table is the coordination source of truth. Update it at the end of each phase before committing that phase.

Status values:

- `not-started`
- `next`
- `in-progress`
- `blocked`
- `complete`

| Phase | Status        | Phase File                                               | Commit  | Notes                                         |
| ----- | ------------- | -------------------------------------------------------- | ------- | --------------------------------------------- |
| 1     | `complete`    | `phase-01-input-core-primitives.md`                      |         | Core input primitives added.                  |
| 2     | `complete`    | `phase-02-text-input.md`                                 | 9d6aeca | Text input core and React binding added.      |
| 3     | `complete`    | `phase-03-select-input.md`                               | 637e349 | Select input core and React binding added.    |
| 4     | `complete`    | `phase-04-table-metadata-projection.md`                  | 5b2be79 | Metadata compatibility and projections added. |
| 5     | `next`        | `phase-05-table-row-identity-pinning-race-protection.md` |         | Requires Phase 4.                             |
| 6     | `not-started` | `phase-06-docs-examples-final-validation.md`             |         | Final validation phase.                       |

At phase completion:

1. Append the required handoff section to the completed phase file.
2. Change that phase status to `complete`.
3. Record the commit hash in the `Commit` column after committing.
4. Mark the next unblocked phase as `next`.
5. Keep all later phases as `not-started`, unless a phase is explicitly `blocked`.

## Agent Pickup Protocol

A phase agent should not load every phase into context by default.

For a fresh pickup:

1. Read this README.
2. Check `git status --short`.
3. Find the row marked `next`.
4. Read only that phase file.
5. If the phase says it requires a prior phase, read that prior phase's handoff section only.
6. Implement only the `next` phase.
7. Run that phase's validation commands.
8. Update that phase's handoff section and this README status table.
9. Commit only that phase's changes.

If no phase is marked `next`, inspect statuses:

- If all phases are `complete`, report that the implementation plan is complete.
- If any phase is `blocked`, report the blocker and do not guess.
- If statuses are inconsistent, ask for clarification before editing code.

## Source Context

Primary learning/design docs currently live outside the tracked `.opencode` tree:

- `.opencode-temp/mosaic-learning/vgplot-inputs-learning.md`
- `.opencode-temp/mosaic-learning/headless-input-core-react-design.md`
- `.opencode-temp/mosaic-learning/headless-data-table-core-tanstack-design.md`

These files may not be tracked. Each phase file below includes enough summary context and a fresh-start prompt so work can continue even if `.opencode-temp` is unavailable.

Repo areas to inspect before implementation:

- `packages/react-mosaic/src`
- `packages/mosaic-tanstack-table-core/src`
- `packages/mosaic-tanstack-react-table/src`
- `docs/core`
- `docs/react`
- existing tests under each touched package

## Decisions

- Use existing packages, not new packages.
- Add sub-exports:
  - `@nozzleio/mosaic-tanstack-table-core/input-core`
  - `@nozzleio/mosaic-tanstack-react-table/inputs`
- Use `as` for Text/Select output, matching vgplot.
- Select must support multi-select.
- Support both `columnDef.meta.mosaicDataTable` and `columnDef.meta.mosaic`.
- New docs/examples should prefer `meta.mosaic`.
- Preserve current public APIs unless a phase explicitly documents a breaking-risk reason.
- Prefer stable field-based row identity for Mosaic row selection, row pinning, pinned-row queries, and projection planning.
- Keep row-values selection as a fallback for vgplot-style behavior.

## Commit Policy

Make one commit after each completed phase.

Each commit should contain:

- implementation changes for only that phase
- tests for the phase
- docs updates when the phase changes public behavior
- the updated phase handoff section in this directory
- validation results recorded in the phase file

Do not commit scratch logs, command transcripts, or temporary exploration dumps.

## Per-Phase Validation

For every phase, run formatting and touched-package validation before committing:

```sh
pnpm test:format
```

If formatting fails:

```sh
pnpm format
pnpm test:format
```

Then run package-level validation for each touched package. Examples:

```sh
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:types
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lint
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:lib
pnpm --filter @nozzleio/mosaic-tanstack-table-core test:build

pnpm --filter @nozzleio/mosaic-tanstack-react-table test:types
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:lint
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:lib
pnpm --filter @nozzleio/mosaic-tanstack-react-table test:build
```

Use the exact package list based on files touched in the phase.

## Final Validation

The final phase must run full repo validation:

```sh
pnpm test:ci
```

If diagnosing failures separately, run:

```sh
pnpm test:format
pnpm test:manifests
pnpm test:types:all
pnpm test:lint:all
pnpm test:lib:all
pnpm test:build:all
```

Run relevant e2e tests when public user-visible example behavior changes:

```sh
pnpm test:e2e
```

## Phase Files

1. `phase-01-input-core-primitives.md`
2. `phase-02-text-input.md`
3. `phase-03-select-input.md`
4. `phase-04-table-metadata-projection.md`
5. `phase-05-table-row-identity-pinning-race-protection.md`
6. `phase-06-docs-examples-final-validation.md`

Each phase file includes a ready-to-use prompt for a fresh implementation conversation.
