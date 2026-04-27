# Phase 6: Docs, Examples, and Final Validation

## Goal

Document the new input and table capabilities, update examples as needed, and run full repo validation.

## Non-Goals

- Do not add new feature behavior unless needed to fix issues discovered during docs/examples validation.
- Do not make broad unrelated docs rewrites.

## Required Context

Read first:

- `.opencode/plans/mosaic-implementation/README.md`
- all previous phase files and handoff sections
- `docs/core/concepts.md`
- `docs/core/data-flow.md`
- `docs/core/package-map.md`
- `docs/react/inputs.md`
- `docs/react/simple-usage.md`
- `docs/react/grouped-table.md`
- relevant example app files under `examples/react/*` if public behavior changed

## Implementation Tasks

- Update docs for:
  - `@nozzleio/mosaic-tanstack-table-core/input-core`
  - `@nozzleio/mosaic-tanstack-react-table/inputs`
  - `useMosaicTextInput`
  - `MosaicTextInput`
  - `useMosaicSelectInput`
  - `MosaicSelect`
  - single-select and multi-select behavior
  - `as: Param | Selection`
  - dynamic `from`
  - `filterBy`
  - native select non-string value preservation
- Update table docs for:
  - `meta.mosaic` preferred namespace
  - `meta.mosaicDataTable` compatibility
  - projection planning
  - stable row identity
  - row selection modes
  - row pinning behavior if implemented
  - stale response handling if public/observable
- Update package map docs for new sub-exports.
- Update examples only where useful and focused.
- Ensure all phase handoff files have validation status and remaining risks recorded.

## Likely Files

- `docs/react/inputs.md`
- `docs/react/simple-usage.md`
- `docs/core/package-map.md`
- `docs/core/data-flow.md`
- `docs/core/concepts.md`
- example files under `examples/react/*` if needed
- previous phase files in `.opencode/plans/mosaic-implementation/`

## Tests

Docs-only changes may not need new tests. If examples or public exports change, add or update:

- public API tests
- React hook tests
- example e2e tests where relevant

## Final Validation

Run full repo validation:

```sh
pnpm test:ci
```

If diagnosing separately:

```sh
pnpm test:format
pnpm test:manifests
pnpm test:types:all
pnpm test:lint:all
pnpm test:lib:all
pnpm test:build:all
```

Run relevant e2e tests if public user-visible example behavior changed:

```sh
pnpm test:e2e
```

## Handoff Update

Before committing, append a "Phase 6 Handoff" section to this file with:

- docs changed
- examples changed
- public APIs documented
- final validation commands and results
- any remaining known gaps

## Commit Checklist

- Working tree contains only Phase 6 changes plus Phase 6 handoff.
- Full repo validation passed or any failure is explicitly documented with cause.
- Final docs prefer `meta.mosaic` while documenting `meta.mosaicDataTable` compatibility.
- Commit message example: `docs: document Mosaic inputs and table metadata`

## Fresh Prompt

```txt
You are working in /Users/seanc/code/work/mosaic-adapters.

Implement Phase 6 from .opencode/plans/mosaic-implementation/phase-06-docs-examples-final-validation.md.

Assume Phases 1-5 are complete. Update docs, examples, public API tests if needed, and all phase handoff notes. Do not add unrelated features. Use rg first for code search and read existing docs/tests before editing. Run full repo validation with pnpm test:ci before final handoff. Make one commit for the phase if validation passes.
```

## Phase 6 Handoff

Docs changed:

- `docs/core/concepts.md`
  - Added Headless Inputs, Table Metadata and Projection, and Row Identity and
    Pinning sections.
- `docs/core/data-flow.md`
  - Documented Param vs Selection input flow, dynamic input option queries, and
    stale async response ordering.
- `docs/core/package-map.md`
  - Added the `@nozzleio/mosaic-tanstack-table-core/input-core` and
    `@nozzleio/mosaic-tanstack-react-table/inputs` sub-exports.
- `docs/react/inputs.md`
  - Added `useMosaicTextInput`, `MosaicTextInput`, `useMosaicSelectInput`, and
    `MosaicSelect` usage, including `as`, dynamic `from`, `filterBy`,
    single-select, multi-select, list-valued columns, and native select
    non-string value preservation.
- `docs/react/simple-usage.md`
  - Expanded `meta.mosaic` metadata, projection planning, row identity, row
    selection modes, and row pinning guidance.
- `docs/react/grouped-table.md`
  - Documented grouped stale-response behavior and the flat-table scope of
    field-based row identity and pinned-row queries.

Examples changed:

- `examples/react/trimmed/src/components/views/athletes-simple.tsx`
  - Updated the first-principles column metadata example from
    `meta.mosaicDataTable` to preferred `meta.mosaic`.

Public APIs documented:

- `@nozzleio/mosaic-tanstack-table-core/input-core`
- `@nozzleio/mosaic-tanstack-react-table/inputs`
- `useMosaicTextInput`
- `MosaicTextInput`
- `useMosaicSelectInput`
- `MosaicSelect`
- Text input `as`, `from`, `column`, `field`, `match`, suggestions, `filterBy`,
  and clearing behavior.
- Select input literal and query-backed options, single-select, multi-select,
  `includeAll`, `listMatch`, `as`, `from`, `column`, `field`, `filterBy`, and
  native non-string value preservation.
- Table `meta.mosaic` preferred namespace, `meta.mosaicDataTable`
  compatibility, projection planning, `rowId`, `getRowId`, `rowSelectionMode`,
  row pinning, and stale-response guards.

Final validation commands and results:

- `pnpm test:format` - failed before formatting; reported
  `docs/core/concepts.md` and `docs/react/inputs.md`.
- `pnpm format` - passed and formatted the changed Markdown files.
- `pnpm test:ci` - passed.
- `pnpm test:e2e` - failed in unrelated Nozzle PAA summary-selection tests:
  15 passed, 4 failed. The changed `athletes-simple` test passed in this run.
- `pnpm --dir examples/react/trimmed exec playwright test tests/athletes-simple.test.ts`
  - passed.
- `pnpm exec prettier examples/react/trimmed/test-results/.last-run.json --write`
  - passed; cleaned generated Playwright status file left by the e2e run.
- `pnpm test:format` - passed after generated-file cleanup.

Remaining known gaps:

- The full affected e2e suite currently has Nozzle PAA summary-selection
  failures unrelated to the Phase 6 docs/example change. The directly changed
  `athletes-simple` example e2e test passes.
