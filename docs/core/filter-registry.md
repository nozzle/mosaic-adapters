# Filter registry

`createFilterRegistry()` — one page-level object that watches registered Selections and normalizes their active clauses into a flat, ordered list of removable chips (the data behind an active-filter bar), plus the global-reset backbone.

Like Selections, a registry is a plain long-lived object created next to the page's topology; framework bindings only subscribe to its store (`useFilterChips` in React).

```ts
const registry = createFilterRegistry();

registry.registerGroup({ id: 'global', label: 'Global Controls', priority: 1 });
registry.registerGroup({
  id: 'summary',
  label: 'Summary Selections',
  priority: 2,
});

registry.register($domain, { group: 'global', label: 'Domain' });
registry.register($selQuestion, {
  group: 'summary',
  label: 'Selected Question',
  explodeValues: true,
  fields: ['related_phrase.phrase'],
});
registry.registerForReset($serpHaving); // reset-only, no chips

// registry.store.state.chips → [{ label, formattedValue, … }] sorted by group priority
registry.removeChip(chip);
registry.resetAll();
```

## Registration

`register(selection, options)` returns an unregister function; re-registering a selection replaces its configuration.

- `group` — chip group; chips sort by the group's `priority` (unknown groups last).
- `label` — fixed label for every chip from this selection: the common case of a single logical publisher per Selection.
- `labelMap` — per-source labels for multi-publisher Selections (e.g. a column-filter bridge), keyed by the clause source's `column` or `id` descriptor; `'*'` is the fallback. Without a match, chips self-label from the same descriptors.
- `formatValue` — custom value formatting. Defaults: two-number arrays render as `lo - hi`, other arrays join with `, `, Dates localize, objects JSON-stringify.
- `explodeValues` — multi-value clauses (point-list tuples from `clausePoints`, plain arrays) render one chip per value instead of a single joined chip.
- `fields` — SQL fields for narrowing a point-list clause when one exploded chip is removed (dotted paths become struct access). Pass the same fields the publisher's `publish.select` uses. Without them, removing any exploded chip clears the whole clause.

Filter-builder clauses are recognized automatically: their committed `StoredFilterValue` envelope is unwrapped so the chip shows the payload (with `value`/`valueTo` ranges joined).

## Removal semantics

`removeChip(chip)` publishes through the same clause machinery the source used:

- The default removes the source's whole clause (`createClearClause`, preserving the clause's `clients` set).
- An exploded point-list chip with registered `fields` republishes the clause narrowed to the remaining tuples — same source, same clients — so a rows client's published selection shrinks by exactly one value. Narrowing to zero clears.

Publishers observe their own removal the same way they observe any external clear: the facet client syncs `selected`, filter-builder bindings sync committed state, a rows client's read-back (`useMosaicSelectionValue`) reflects the narrowed value. For TanStack bridge clauses, pair the registry with the bridge's `onExternalClear` write-back so the column-filter state prunes too.

## Global reset

`resetAll()` calls `selection.reset()` on every registered selection — both chip registrations and `registerForReset` ones (Selections that need resetting but whose chip lives elsewhere, e.g. a HAVING-routed companion Selection). `reset()` invokes clause sources' `reset()` hooks and relays into `include`-composed contexts, so downstream widgets unfilter without extra wiring.

## Timing

Selection value events dispatch asynchronously once listeners attach, so the chip list settles a tick after a publish. Internally the registry reads the Selection's synchronously-maintained `_resolved` clause list, so `removeChip` acts on current state even mid-cascade.
