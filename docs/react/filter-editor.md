# Filter editor recipe

A filter _editor_ — a builder row, a dialog, a sidebar block — is transient UI over a [`FilterSet`](../core/filter-set.md). The editor holds a **draft** in local component state; on commit it builds a `FilterSpec` from those draft values and calls `filterSet.set(spec)`. Nothing else in the app can tell the spec came from an editor rather than a hardcoded control — a spec is a spec.

The whole recipe exists to enforce one invariant:

> **Build the spec from the draft values at commit time. Never an argument-less `apply()` that reads shared state.**

An `apply()` that reaches back into a store, a ref, or `filterSet.store.state` to reconstruct the spec is the stale-closure bug class this recipe prevents: the handler captures a value from an earlier render, or reads state that a concurrent edit has already moved, and publishes the wrong predicate. Pass the draft values _into_ the spec builder as arguments; then what you commit is exactly what the user sees.

The reference implementation is the "Builder" view in [`examples/react/nozzle-paa/src/components/filter-builder.tsx`](../../examples/react/nozzle-paa/src/components/filter-builder.tsx); the operator vocabulary it enumerates is documented in [`docs/core/filter-set.md`](../core/filter-set.md#operators).

## Draft state over a FilterSet

Keep the in-progress edit in `useState`, build the spec from the draft on submit, and write it with `set()`. `set()` upserts by `id`, so re-submitting the same editor replaces its spec (and publish is suppressed when the SQL is unchanged).

```tsx
import { useState } from 'react';
import { usePageFilterSet } from './topology';
import type { FilterSpec } from '@nozzleio/react-mosaic';

function ConditionEditor(props: { id: string; column: string; label: string }) {
  const filterSet = usePageFilterSet();
  const [operator, setOperator] = useState('eq');
  const [value, setValue] = useState('');

  const submit = () => {
    // Build the spec from the DRAFT values passed in — never read shared state
    // back to reconstruct it.
    const spec: FilterSpec = {
      id: props.id,
      column: props.column,
      kind: 'condition',
      operator,
      value,
      label: props.label,
    };
    filterSet.set(spec);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* operator + value inputs bound to the draft state */}
    </form>
  );
}
```

## Driven by operator arity

The value control(s) are chosen by the operator's `arity` (`none | unary | range | set`) — the metadata each operator-interpreting kind carries. This is what lets one editor serve any operator without hard-coding a value input per operator. See the [Operators section of the filter-set docs](../core/filter-set.md#operators) for the full per-kind operator tables and the arity→input mapping (don't duplicate them — enumerate `builtinFilterKinds.<kind>.operators` at runtime and read `arity`).

The commit-time spec builder branches on arity. This is the core of the pattern — draft values in, a `FilterSpec | null` out (`null` means "incomplete, remove the spec"):

```ts
function buildSpec(
  id: string,
  column: string,
  kind: string,
  label: string,
  operatorId: string,
  arity: OperatorArity,
  value: string,
  valueTo: string,
): FilterSpec | null {
  const spec: FilterSpec = { id, column, kind, operator: operatorId, label };

  if (arity === 'none') {
    // is_null / is_empty — apply immediately, no value input at all.
    return spec;
  }
  if (arity === 'range') {
    // between — two inputs; incomplete until both are present.
    if (value.trim() === '' || valueTo.trim() === '') {
      return null;
    }
    spec.value = value.trim();
    spec.valueTo = valueTo.trim();
    return spec;
  }
  if (arity === 'set') {
    // in / not_in — a multi-value input; spec.value is an array.
    const items = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (items.length === 0) {
      return null;
    }
    spec.value = items;
    return spec;
  }
  // unary — a single value input → spec.value.
  if (value.trim() === '') {
    return null;
  }
  spec.value = value.trim();
  return spec;
}
```

- **`none`** — no value; apply immediately when the operator is picked (there is nothing to type).
- **`unary`** — one input → `spec.value`.
- **`range`** — two inputs → `spec.value` + `spec.valueTo`; incomplete (build `null`) until both are filled.
- **`set`** — a multi-value input → `spec.value` as an array.

Commit as: `const spec = buildSpec(…); spec === null ? filterSet.remove(id) : filterSet.set(spec);`.

## Clearing: remove vs publish-inactive

Two ways to un-apply a filter, and they mean different things:

- **`filterSet.remove(id)`** — delete the spec and clear its clauses. The editor row goes away. Use this when the user removes a filter.
- **`filterSet.clear(id)`** — keep the spec but drop its value (inactive). The row stays visible with no value yet — the "I want to filter on this column but haven't chosen a value" state of a builder. Use this when the editor row should persist but hold no active predicate.

The builder above collapses to `remove(id)` on an incomplete draft (a value cleared to empty). If you want the row to linger empty instead, `clear(id)` there.

## Pairing with the facet hook for option-list editors

When the value input is an option list rather than free text — a multi-select over a column's distinct values — pair the editor with [`useMosaicFacet`](../core/facet-client.md) for the options and let it own the spec read/write. The `set`-arity operators (`in`, `not_in`, and the array `list_has_any` / `list_has_all`) map directly onto a facet multi-select: the selected values are `spec.value` (an array). An emptiness operator (`is_empty`, arity `none`) hides the option list and writes a valueless spec. The reference `FacetValue` block in `filter-builder.tsx` shows the operator↔arity switch driving whether the option list renders at all.

## Variant: live-debounced publish

The primary pattern commits on an explicit submit. The nozzle-paa reference implements a **live** variant instead: text inputs publish through a debounce and facet/select changes publish immediately, so the page filters as the user types. It teaches the _same_ invariant — `buildSpec` still takes the draft values as arguments and produces the spec; the debounce only changes _when_ `run()` fires, never _where the values come from_.

The reusable arity→spec core is `buildSpec` in [`filter-builder.tsx`](../../examples/react/nozzle-paa/src/components/filter-builder.tsx) (roughly lines 447–501) — the same four-arity branch shown above, plus target routing for HAVING-placed and self-routing kinds. The live path wraps it:

```tsx
const publish = (
  nextOperatorId: string,
  nextValue: string,
  nextValueTo: string,
  immediate: boolean,
) => {
  const run = () => {
    const spec = buildSpec(/* draft values passed in */);
    spec === null ? filterSet.remove(specId) : filterSet.set(spec);
  };
  if (immediate) {
    debounce.cancel();
    run();
    return;
  }
  debounce.run(run);
};
```

Two subtleties the reference handles, both consequences of publishing live:

- **Cancel the debounce on external removal.** If a chip ✕ or Clear All removes the spec while a keystroke's debounce is armed, the pending `run()` would resurrect the deleted filter from stale draft text. The reference mirrors committed spec → controls and cancels the armed publish when the spec disappears externally, guarded by a `pendingWriteRef` so an in-progress local edit is not fought.
- **Remount the value control on placement/spec-id change.** Keying each value control by its active `spec.id` means switching placement remounts it, running the outgoing control's unmount cleanup (which cancels its debounce) so a pending keystroke cannot republish a just-removed spec.

Both are the same theme as the invariant: the committed spec is always built from the current draft, and stale drafts are actively prevented from publishing.

## Sorting and pagination

A filter editor changes result size, so a table paired with one can strand on an out-of-range page. That is not filter-editor state — clamp `pageIndex` against the rows client's `totalRows`. See the [TanStack Table integration clamping notes](../tanstack-table/integration.md#manual-mode-wiring) (`clampPagination`); no new clamping logic belongs here.

## See also

- [Filter set (core)](../core/filter-set.md) — the `FilterSpec` model, `set`/`remove`/`clear`, the two authoring styles, and the [operator vocabulary](../core/filter-set.md#operators).
- [Facet client](../core/facet-client.md) — the options query for option-list value editors.
- [Router persistence](./router-persistence.md) — persisting the resulting `FilterSpec[]` to the URL / a store.
- [Topology recipes](./topology-recipes.md) — the active-filter chip bar the editor's specs feed into.
- [nozzle-paa](../../examples/react/nozzle-paa) — the wired reference (`src/components/filter-builder.tsx`).
