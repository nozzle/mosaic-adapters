# Filter set

`createFilterSet({ targets, kinds?, persist?, context? })` — the single owner of a page's managed filter intent. A keyed store of plain-JSON `FilterSpec` objects; each spec is turned into one standard clause per target Selection through a kind registry, so dashboard filter state is serializable data all the way down.

Like Selections, a filter set is a plain long-lived object created next to the page's topology; framework bindings only subscribe to its store.

```ts
const $where = Selection.crossfilter();
const $having = Selection.intersect();

const filters = createFilterSet({
  targets: { where: $where, having: $having },
});

filters.set({
  id: 'sport',
  column: 'sport',
  kind: 'points',
  value: ['judo', 'rowing'],
});
filters.set({
  id: 'w',
  column: 'weight',
  kind: 'condition',
  operator: 'gte',
  value: 60,
});
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

## One primitive, two authoring styles

There is no separate "config-defined filter" and "user-built filter" type — both are just a `FilterSpec` written to the same set. They differ only in _which UI writes the spec_:

- **Config-defined** — a static spec table the app renders as inputs. Each row fixes `id`/`column`/`kind`/`label`; the input supplies the value. This is the top-bar / sidebar shape.
- **User-built (navbar-style)** — specs constructed at runtime from user choices: pick a column, pick an operator, type a value, add the row. The spec is assembled on submit.

Both call `set()` with the same shape, land on the same targets, and produce the same chips and serialized state:

```ts
// Config-defined: a fixed row rendered as a text input.
const TOP_BAR = [
  { id: 'phrase', column: 'phrase', kind: 'match', label: 'Keyword' },
] as const;
filters.set({ ...TOP_BAR[0], operator: 'contains', value: input.value });

// User-built: the same spec assembled from a builder row's current choices.
filters.set({
  id: `f${row.id}`,
  column: row.column, // chosen from a column menu
  kind: 'condition',
  operator: row.operator, // chosen from an operator menu
  value: row.value, // typed
  label: row.columnLabel,
});
```

A downstream consumer cannot tell which UI produced a spec; the chip bar, persistence, and clause resolution treat them identically. Design filter UIs around _producing specs_, not around a filter "type".

## Serializable state

A spec is plain JSON — `JSON.parse(JSON.stringify(spec))` must reproduce identical SQL (the round-trip rule). Kinds never depend on non-serializable values: no `Date` instances, no class instances, no functions in `value`. Store ISO date strings, not `Date`s; store scalars and plain arrays, and let DuckDB coerce column types.

What belongs where:

- **In the spec** — the persisted _intent_: `id`, `column`, `kind`, `operator`, `value`/`valueTo`, `target`, `label`. This is everything needed to rebuild the clause.
- **Widget state, not the spec** — transient UI that does not change the query: an input's focus, a menu's open/closed flag, an un-submitted draft, an exploded chip's hover. Keep it in component state; only the committed value becomes a spec.

Hydration replays a persisted `FilterSpec[]` through `set()` — the _same_ code path as a live interaction, not a separate "load" path. The setters are the re-hydration API, so there is exactly one way a spec enters the set and one clause-derivation to reason about. See [nozzle-paa](../../examples/react/nozzle-paa) for a wired URL implementation (specs ⇄ `location.search`), and the [router persistence recipe](../react/router-persistence.md) for driving the setters from a router.

## Targets and WHERE/HAVING routing

`targets` is a named map of Selections. Single-Selection pages pass `{ where: $sel }` and never think about it; a spec's `target` (or a kind emission's `target`) picks the Selection its clause lands on. SQL position is decided by how consumers wire the Selection — `filterBy` renders it in WHERE, `havingBy` in HAVING. The set cannot enforce that a `having`-targeted Selection is actually consumed via `havingBy`; it warns once in dev when a spec first emits to a `having` target.

A clause cleared elsewhere (chip bar, `selection.reset()`) removes the owning spec and fires a persist write with reason `'external'` — the set mirrors external state exactly like the data clients do.

## Built-in kinds

| kind        | value                                                        | clause                                                                  |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `point`     | scalar (`null` matches SQL NULL)                             | point equality                                                          |
| `points`    | scalar array, or `{ columns, tuples }` for multi-column keys | membership (IN / tuple OR), exploded chips                              |
| `interval`  | `[lo, hi]`, or `value`/`valueTo` bounds                      | BETWEEN; half-open ranges emit `>=`/`<=` without interval metadata      |
| `match`     | string; `operator`: `contains` (default) or `prefix`         | case-insensitive text match                                             |
| `condition` | operator-driven scalar/range predicates                      | `eq neq gt gte lt lte between in not_in contains starts_with is_null …` |

`condition` accepts operator aliases (`is`, `is_any_of`, `before`, `on_or_after`, …) and coerces column types per value (`TRY_CAST` for numbers/dates). For array columns or explicit typing, register a tuned variant:

```ts
const filters = createFilterSet({
  targets: { where: $where },
  kinds: {
    tags: conditionFilterKind({ columnType: 'array' }), // list_has_any / list_has_all
  },
});
```

## Operators

A `FilterKind` may carry introspection metadata describing the operators it interprets, so a generic filter-picker UI can enumerate a kind's operators and pick the right value input without hard-coding the vocabulary.

```ts
type OperatorArity = 'none' | 'unary' | 'range' | 'set';

interface OperatorDescriptor {
  id: string; // canonical operator id written to spec.operator
  label?: string; // human label for a menu
  arity?: OperatorArity; // value cardinality
}

interface FilterKind {
  /* existing: emit, formatValue?, explodeValues? */
  operators?: ReadonlyArray<OperatorDescriptor>;
}
```

`arity` maps to how many values the spec carries:

| arity   | spec shape                    | example operators     |
| ------- | ----------------------------- | --------------------- |
| `none`  | no value                      | `is_null`, `is_empty` |
| `unary` | single `spec.value`           | `eq`, `contains`      |
| `range` | `spec.value` + `spec.valueTo` | `between`             |
| `set`   | array `spec.value`            | `in`, `not_in`        |

This is descriptive metadata only — `FilterSet.set()` performs no runtime enforcement against it.

`operators` is populated on the two operator-interpreting built-in kinds, `condition` and `match`. `point`/`points`/`interval` never read `spec.operator`, so they omit it. The typed unions **`ConditionOperator`** and **`MatchOperator`** are exported and derived from the same const-asserted descriptor arrays, so the runtime ids and the compile-time union cannot drift.

`match` operators (all `unary`):

| id         | label          |
| ---------- | -------------- |
| `contains` | contains       |
| `prefix`   | starts with    |
| `suffix`   | ends with      |
| `regexp`   | matches regexp |

`condition` operators:

| id                | label                 | arity   |
| ----------------- | --------------------- | ------- |
| `eq`              | equals                | `unary` |
| `neq`             | does not equal        | `unary` |
| `gt`              | greater than          | `unary` |
| `gte`             | greater than or equal | `unary` |
| `lt`              | less than             | `unary` |
| `lte`             | less than or equal    | `unary` |
| `contains`        | contains              | `unary` |
| `not_contains`    | not contains          | `unary` |
| `starts_with`     | starts with           | `unary` |
| `not_starts_with` | does not start with   | `unary` |
| `ends_with`       | ends with             | `unary` |
| `not_ends_with`   | does not end with     | `unary` |
| `is_null`         | is null               | `none`  |
| `not_null`        | is not null           | `none`  |
| `is_empty`        | is empty              | `none`  |
| `is_not_empty`    | is not empty          | `none`  |
| `between`         | between               | `range` |
| `in`              | is any of             | `set`   |
| `not_in`          | is not any of         | `set`   |
| `list_has_any`    | has any of            | `set`   |
| `list_has_all`    | has all of            | `set`   |
| `excludes_all`    | excludes all of       | `set`   |

The `condition` kind still accepts operator aliases at runtime (`is`, `is_any_of`, `before`, `on_or_after`, …), but those are deliberately absent from the descriptor list: each resolves to one of the canonical ids above, so a picker enumerates canonical operators only.

A picker reads `builtinFilterKinds.condition.operators` to render the menu, then chooses the value input by `arity`:

```tsx
import { builtinFilterKinds } from '@nozzleio/mosaic-core';

const ops = builtinFilterKinds.condition.operators ?? [];

<select value={operator} onChange={(e) => setOperator(e.currentTarget.value)}>
  {ops.map((op) => (
    <option key={op.id} value={op.id}>
      {op.label ?? op.id}
    </option>
  ))}
</select>;

const arity = ops.find((op) => op.id === operator)?.arity ?? 'unary';
// none  → render nothing; set spec.value undefined
// unary → one input        → spec.value
// range → two inputs        → spec.value + spec.valueTo
// set   → tag/multi input   → spec.value (array)
```

See [nozzle-paa](../../examples/react/nozzle-paa) for a live implementation of exactly this picker.

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

filters.set({
  id: 'min-domains',
  column: 'phrase',
  kind: 'min-domains',
  value: 3,
});
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

`chip.target` is the **resolved** routing target — where the kind's emission actually landed (`emission.target ?? spec.target ?? 'where'`), not the declared `spec.target`. A self-routing kind that overrides the target on every emission (e.g. metric-threshold → `having:<card>` + `members:<card>`) reports the resolved target on its chip, so a decorative `spec.target` is no longer needed to label such chips (and no longer silently lost on URL hydration). When a kind emits to multiple targets for one spec, `chip.target` is the deterministic primary: the first emission's resolved target in kind-declaration order. Exploded chips report the same resolved target as their parent spec. Before a spec has published an active clause, `chip.target` falls back to `spec.target ?? 'where'`.

In React, subscribe with `useFilterSetState(filters)` / `useFilterSetChips(filters)` from `@nozzleio/react-mosaic`.

## Persistence

`persist` takes a [`Persister<Array<FilterSpec>>`](../core/concepts.md): the whole set persists as one entry, since the set is a dynamic collection — per-spec storage stays achievable consumer-side by splitting inside the persister closures. Same lifecycle as the data clients: a sync `read` hydrates before the first publish (zero flash, zero echo writes — including under StrictMode double-mounting), async reads apply on resolve unless the user already interacted, writes carry reasons `'update' | 'clear' | 'external'`, and `destroy()` never writes. Reactive stores (router search params) skip the persister and drive `set()`/`remove()` directly — the setters are the re-hydration API. For wiring a persister over a router (`navigate({ search })`) or driving the setters from reactive search params, see the [router persistence recipe](../react/router-persistence.md).

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
