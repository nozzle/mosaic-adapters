# Filter set

`createFilterSet({ targets, kinds?, persist?, context? })` — the single owner of a page's managed filter intent. A keyed store of plain-JSON `FilterSpec` objects; each spec is turned into one standard clause per target Selection through a kind registry, so dashboard filter state is serializable data all the way down.

Like Selections, a filter set is a plain long-lived object created next to the page's topology; framework bindings only subscribe to its store.

```ts
const $where = Selection.crossfilter();
const $having = Selection.intersect();

const filters = createFilterSet({ targets: { where: $where, having: $having } });

filters.set({ id: 'sport', column: 'sport', kind: 'points', value: ['judo', 'rowing'] });
filters.set({ id: 'w', column: 'weight', kind: 'condition', operator: 'gte', value: 60 });
filters.remove('sport');
filters.reset();
```

## The model

Three layers: a `FilterSpec` is intent (what the user chose), the kind registry derives clauses from it, and the target Selections carry those clauses to consumers. Intent → clause is deterministic, so persisting or sharing a dashboard's filters means persisting the specs — `JSON.parse(JSON.stringify(specs))` replayed through `set()` reproduces byte-identical predicates.

```ts
type FilterSpec = {
  id: string; // stable key — replacement, chips, persistence
  column: string; // column name or struct path ('related_phrase.phrase')
  kind: string; // registry key
  operator?: string;
  value?: unknown; // plain JSON only
  valueTo?: unknown;
  target?: string; // default 'where'
  label?: string; // chip label override
};
```

`set(spec)` upserts by `id` (replace-on-update, publish suppressed when the SQL is unchanged), `remove(id)` deletes the spec and clears its clauses, `clear(id)` keeps the spec but drops its value (inactive — a builder row with no value yet), `reset()` empties the set. Two specs on the same column coexist — `id` is the key, not `column`.

## Targets and WHERE/HAVING routing

`targets` is a named map of Selections. Single-Selection pages pass `{ where: $sel }` and never think about it; a spec's `target` (or a kind emission's `target`) picks the Selection its clause lands on. SQL position is decided by how consumers wire the Selection — `filterBy` renders it in WHERE, `havingBy` in HAVING. The set cannot enforce that a `having`-targeted Selection is actually consumed via `havingBy`; it warns once in dev when a spec first emits to a `having` target.

A clause cleared elsewhere (chip bar, `selection.reset()`) removes the owning spec and fires a persist write with reason `'external'` — the set mirrors external state exactly like the data clients do.

## Built-in kinds

| kind        | value                                                        | clause                                                                    |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `point`     | scalar (`null` matches SQL NULL)                             | point equality                                                            |
| `points`    | scalar array, or `{ columns, tuples }` for multi-column keys | membership (IN / tuple OR), exploded chips                                |
| `interval`  | `[lo, hi]`, or `value`/`valueTo` bounds                      | BETWEEN; half-open ranges emit `>=`/`<=` without interval metadata        |
| `match`     | string; `operator`: `contains` (default) or `prefix`         | case-insensitive text match                                               |
| `condition` | operator-driven scalar/range predicates                      | `eq neq gt gte lt lte between in not_in contains starts_with is_null …`   |

`condition` accepts operator aliases (`is`, `is_any_of`, `before`, `on_or_after`, …) and coerces column types per value (`TRY_CAST` for numbers/dates). For array columns or explicit typing, register a tuned variant:

```ts
const filters = createFilterSet({
  targets: { where: $where },
  kinds: {
    tags: conditionFilterKind({ columnType: 'array' }), // list_has_any / list_has_all
  },
});
```

## Custom kinds

A kind maps a spec to one or more clauses on named targets — the consolidation point for anything that used to be a hand-rolled publisher. `subqueryFilterKind(build)` ports the membership-subquery machinery: `build` receives the spec, the struct-path-resolved column expression, and `contextPredicate` — the AND of the context Selection's clauses excluding this spec's own. Reading `contextPredicate` marks the spec context-dependent: when the context Selection changes, the set republishes the affected specs (suppressed when the SQL is unchanged, so rebuilds converge).

```ts
const filters = createFilterSet({
  targets: { where: $where },
  context: $where,
  kinds: {
    'min-domains': subqueryFilterKind(({ spec, contextPredicate }) =>
      Query.from('serps')
        .select('phrase')
        .where(contextPredicate ?? [])
        .groupby('phrase')
        .having(gte(count('domain'), literal(spec.value))),
    ),
  },
});

filters.set({ id: 'min-domains', column: 'phrase', kind: 'min-domains', value: 3 });
```

Multi-target kinds return several emissions — e.g. a metric threshold emitting a HAVING clause to its own card and a membership subquery to everyone else:

```ts
const kind: FilterKind = {
  emit: ({ spec, column, contextPredicate }) => [
    { target: 'having', clause: { predicate: havingPredicate } },
    { target: 'where', clause: { predicate: membershipPredicate } },
  ],
};
```

Subquery predicates never carry clause metadata (Mosaic's pre-aggregator only understands point/interval shapes).

## Publishing into the set

Widgets support two publish paths, both Mosaic-native — downstream consumers cannot tell who called `selection.update`:

- `publish: { into: filterSet, id }` — managed: the widget writes specs instead of clauses, so its filter shows up in chips, persistence, and serialized state. External removal of the spec mirrors back into widget state (selection cleared), and self-exclusion survives — the set attaches the widget's client to the published clauses, so `Selection.crossfilter()` semantics are unchanged.
- `publish: { as: selection }` — direct: ephemeral viz interaction.

The rule: **if the user should see it as "a filter", route it into the set; if it's transient brushing or linking, publish direct.** Facet, histogram, and rows clients accept both forms (`rows` on its `select` target only; hover is transient by definition). Client-level `persist` is ignored under `publish.into` — the set owns persistence.

```ts
const facet = createFacetClient({
  /* … */
  publish: { into: filters, id: 'sport' },
});
```

## Chips

`store.state.chips` derives from the specs — label from `label`/`column`, value formatted per kind (ranges join as `lo - hi`, arrays explode into one chip per value for multi-value kinds). `removeChip(chip)` narrows an exploded value or removes the spec; `reset()` clears the bar. Foreign clauses published directly onto the Selections are chip-invisible by design; the chip list derives from an iterable so a future adapter can contribute entries additively.

In React, subscribe with `useFilterSetState(filters)` / `useFilterSetChips(filters)` from `@nozzleio/react-mosaic`.

## Persistence

`persist` takes a [`Persister<Array<FilterSpec>>`](../core/concepts.md): the whole set persists as one entry, since the set is a dynamic collection — per-spec storage stays achievable consumer-side by splitting inside the persister closures. Same lifecycle as the data clients: a sync `read` hydrates before the first publish (zero flash, zero echo writes — including under StrictMode double-mounting), async reads apply on resolve unless the user already interacted, writes carry reasons `'update' | 'clear' | 'external'`, and `destroy()` never writes. Reactive stores (router search params) skip the persister and drive `set()`/`remove()` directly — the setters are the re-hydration API.

```ts
const filters = createFilterSet({
  targets: { where: $where },
  persist: {
    read: () => JSON.parse(localStorage.getItem('filters') ?? 'null'),
    write: (specs) =>
      specs === null
        ? localStorage.removeItem('filters')
        : localStorage.setItem('filters', JSON.stringify(specs)),
  },
});
```
