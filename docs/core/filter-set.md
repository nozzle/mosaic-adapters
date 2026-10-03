# Filter set

`createFilterSet({ targets, defaultTarget?, kinds?, persist?, context? })` — the single owner of a page's managed filter intent. A keyed store of plain-JSON `FilterSpec` objects; each spec is turned into one standard clause per target Selection through a kind registry, so dashboard filter state is serializable data all the way down.

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
  columnPaths?: 'struct' | 'literal'; // 'literal': a dotted name is ONE identifier
  kind: string; // registry key
  operator?: string;
  value?: unknown; // plain JSON only
  valueTo?: unknown;
  target?: string; // default: the set's `defaultTarget` ('where')
  label?: string; // chip label override
};
```

`set(spec)` upserts by `id` (replace-on-update, publish suppressed when the SQL is unchanged), `remove(id)` deletes the spec and clears its clauses, `clear(id)` keeps the spec but drops its value (inactive — a builder row with no value yet), `reset()` empties the set, and [`batch(fn)`](#several-writes-as-one-update-batch-opt-in) applies several of these writes as one update. Two specs on the same column coexist — `id` is the key, not `column`.

A dotted `column` is a struct path by default: `meta.country` resolves to `"meta"."country"`. For a column whose name itself contains a dot, set `columnPaths: 'literal'` and the set reads it as one identifier, `"meta.country"`, in the kind's `args.column`, in the columns of a multi-column `points` envelope, and in a `subqueryFilterKind`'s outer column. The field is plain JSON, so it persists and hydrates with the spec. Facet and histogram clients created with `columnPaths: 'literal'` write it onto their `publish.into` specs.

### Clear all except some: `reset({ keep })`

`reset({ keep })` removes every spec the predicate rejects and leaves the accepted ones alone — their clauses stay published and the reset itself does not re-publish them. The one exception is a kept spec whose kind reads `contextPredicate` (see [custom kinds](#custom-kinds)): removing its siblings changes the context, so it rebuilds like after any other sibling change (and publishes nothing if its SQL is unchanged). It is still one store update and one persister write (`'update'` with the surviving specs, or `null` / `'clear'` if nothing survives). If `keep` accepts every spec, the call does nothing: no store update and no write.

```ts
// "Clear all" that keeps pinned filters.
filters.reset({ keep: (spec) => spec.id.startsWith('pinned:') });
```

Calling `reset()` and then re-adding the pinned specs gives the same end state, but every target runs an extra query round, and one of those rounds runs without the pinned filter. To run this from a page-wide "Clear all" in a [topology](./selection-topology.md), see the [page-wide reset recipe](../react/topology-recipes.md#keeping-some-filter-set-specs).

### Several writes as one update: `batch()` (opt-in)

Every `set` / `remove` / `clear` / `reset` call publishes on its own. When one user action makes several writes — a filter editor's Apply, replaying a saved view — wrap them in `batch()` to publish them as one update:

```ts
filters.batch((tx) => {
  tx.remove('date');
  tx.set(sportSpec);
  tx.set(weightSpec);
});
```

Nothing changes unless you call `batch`. How much it saves depends on the target's resolver:

- **Crossfilter** targets run one query round per write: Mosaic's dispatch queue keeps one pending update per clause source.
- **Intersect, union and single** targets already collapse to about two rounds: the first write runs right away and the queue keeps only the latest value.

Batched, both run one round. In detail:

- Each write updates the target's resolved clauses as it happens, so context predicates and later writes in the batch see it. When the callback returns, every touched Selection emits once: targets, and the `compose` / `cascading` contexts and skip projections derived from them. Then `store` updates once and the persister is written once (`'update'`, or `null` / `'clear'` if the set ended up empty; `'external'`, as without a batch, when the only change was a clause dropped from outside the set).
- `store.state` is not updated until the batch ends.
- On a `single` target only the last write's clause survives, so the combined update drops the clauses of earlier specs written to it. The set treats that like any external drop and removes those specs, as it does without a batch once the dropped clause is delivered. In a batch this happens before anything emits: a removed spec's clauses on its other targets (a kind that also publishes to a `members` target, say) are cleared inside the batch, so each of those targets still emits once, with the final state. `store` updates and the persister is written once, with `'update'`.
- A kind that reads `contextPredicate` is rebuilt inside the batch, so it ships with its siblings' new clauses even if it was written before them. In a topology whose FilterSets read each other's targets as contexts (A's context is B's target, B's is C's), the rebuilds repeat until nothing changes, so every set in the chain emits once with the final state. A cyclic context graph (A reads B and B reads A) is not guaranteed to settle inside the batch; it may emit again from the usual rebuild after the batch.
- **Pre-aggregation is skipped for the combined update.** Mosaic's pre-aggregator reuses a cached view for as long as the same clause source stays active, and that view holds the values the _other_ clauses had when it was built. A combined update changes several clauses at once, so it is emitted with a synthetic active clause instead: a fresh source with no predicate. The pre-aggregator drops its cache and the coordinator runs the standard query for that one update; the next ordinary interaction builds views again. Two side effects: `selection.active` is that synthetic clause (`selection.value` still reports the last written value; it has no `meta` and empty `fields`, so code that reads `selection.active.meta` after a batched update gets `undefined`), and on a crossfilter target the widget that published a clause re-queries too (its own clause is still excluded from its query).
- Only this set's writes are deferred. A write made directly on a Selection (`selection.update`, an interactor) or a Param inside the callback is dispatched as usual, without waiting for the batch. A Param that is still dispatching an earlier update may deliver its new value after the batched Selections emit; see [Params in `topology.batch()`](./selection-topology.md#batch).
- It is not a transaction. If the callback throws, the writes made before the throw still apply and emit, then the callback's error propagates (even if a listener also throws while the batch closes).
- `tx` is the set's own mutators; calling `filters.set(...)` inside the callback is batched too. A nested `filters.batch()` joins the outer one. On a destroyed set the callback still runs and its writes are no-ops.
- Only one batch can be open at a time. Opening a batch on a _different_ FilterSet (or a `topology.batch()`) inside the callback throws, before that inner callback runs. Two separate batches would each flush on their own, so a Selection or context they share would emit more than once, and not always with the final state. To batch writes to several sets, use `topology.batch()` on a topology that owns them all. Writes to another set made without `batch` (a plain `other.set(...)`) are not deferred: they emit immediately, as usual. The batch counts as open until it has emitted, so a `batch()` on another set or a topology from a filter kind rebuilt against the new context throws as well (a `batch()` on the same set joins, as above), and so does any `batch()` from a `value` listener fired by the flush. The error message is exported as `NESTED_BATCH_ERROR_MESSAGE`.
- Each Selection derived from a target is updated in the same batch, including a skip projection (`skipSources`) and anything composed over it. A custom `Selection` subclass that overrides `update` or `reset` (including one from `createMappedSelection`, other than the skip projection) cannot be deferred: it is written with its own method and emits immediately, as it would without a batch.
- The callback must be synchronous. With an `async` callback, writes after the first `await` run after the batch has closed and are not batched.

In a [topology](./selection-topology.md#batch), `topology.batch()` shares one batch across every FilterSet it owns, and a `filterSet.batch()` on an owned set inside it joins that batch. The other direction is not supported: `topology.batch()` inside a `filterSet.batch()` throws. Open the topology batch on the outside instead. A `filterSet.batch()` opened on its own (outside any `topology.batch()`) is not a topology batch: an owning topology refreshes `activeClauses` once per Selection the set touched rather than once overall, so prefer `topology.batch()` when one set writes to several targets.

## One primitive, two authoring styles

There is no separate "config-defined filter" and "user-built filter" type — both are just a `FilterSpec` written to the same set. They differ only in _which UI writes the spec_:

- **Config-defined** — a static spec table the app renders as inputs. Each row fixes `id`/`column`/`kind`/`label`; the input supplies the value. This is the top-bar / sidebar shape.
- **User-built (navbar-style)** — specs constructed at runtime from user choices: pick a column, pick an operator, type a value, add the row. The spec is assembled on submit.

Both call `set()` with the same shape, land on the same targets, and produce the same chips and serialized state:

```ts
// Config-defined: a fixed row rendered as a text input.
const TOP_BAR = [{ id: 'phrase', column: 'phrase', kind: 'match', label: 'Keyword' }] as const;
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

A downstream consumer cannot tell which UI produced a spec; the chip bar, persistence, and clause resolution treat them identically. Design filter UIs around _producing specs_, not around a filter "type". For the user-built shape — draft state, an arity-driven value input, and building the spec from the draft at commit time (never an argument-less apply that reads shared state) — see the [filter editor recipe](../react/filter-editor.md).

## Serializable state

A spec is plain JSON — `JSON.parse(JSON.stringify(spec))` must reproduce identical SQL (the round-trip rule). Kinds never depend on non-serializable values: no `Date` instances, no class instances, no functions in `value`. Store ISO date strings, not `Date`s; store scalars and plain arrays, and let DuckDB coerce column types.

What belongs where:

- **In the spec** — the persisted _intent_: `id`, `column`, `kind`, `operator`, `value`/`valueTo`, `target`, `label`. This is everything needed to rebuild the clause.
- **Widget state, not the spec** — transient UI that does not change the query: an input's focus, a menu's open/closed flag, an un-submitted draft, an exploded chip's hover. Keep it in component state; only the committed value becomes a spec.

Hydration replays a persisted `FilterSpec[]` through `set()` — the _same_ code path as a live interaction, not a separate "load" path. The setters are the re-hydration API, so there is exactly one way a spec enters the set and one clause-derivation to reason about. See [nozzle-paa](../../examples/react/nozzle-paa) for a wired URL implementation (specs ⇄ `location.search`), and the [router persistence recipe](../react/router-persistence.md) for driving the setters from a router.

## Targets and WHERE/HAVING routing

`targets` is a named map of Selections. Single-Selection pages pass `{ where: $sel }` and never think about it; a spec's `target` (or a kind emission's `target`) picks the Selection its clause lands on. The resolution order is `emission.target ?? spec.target ?? defaultTarget`. `defaultTarget` defaults to `'where'`. Set it when the set has no `where` target; otherwise any spec that names no target (including specs from `publish.into` widgets with no `target`) is warned about and dropped:

```ts
const filters = createFilterSet({
  targets: { members: $members, having: $having },
  defaultTarget: 'members', // specs without a target land on $members
});
```

An explicit `defaultTarget` must name one of `targets`, or `createFilterSet` throws. `filters.defaultTarget` reads back the resolved value. SQL position is decided by how consumers wire the Selection — `filterBy` renders it in WHERE, `havingBy` in HAVING. The set cannot enforce that a `having`-targeted Selection is actually consumed via `havingBy`; it warns once in dev when a spec first emits to a `having` target.

A clause cleared elsewhere (chip bar, `selection.reset()`) removes the owning spec and fires a persist write with reason `'external'` — the set mirrors external state exactly like the data clients do.

## Built-in kinds

| kind        | value                                                        | clause                                                              |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `point`     | scalar (`null` matches SQL NULL)                             | point equality                                                      |
| `points`    | scalar array, or `{ columns, tuples }` for multi-column keys | membership (IN / tuple OR), exploded chips                          |
| `interval`  | `[lo, hi]`, or `value`/`valueTo` bounds                      | BETWEEN; half-open ranges emit `>=`/`<=` without interval metadata  |
| `match`     | string; `operator`: `contains` (default) or `prefix`         | case-insensitive text match                                         |
| `condition` | operator-driven scalar/range predicates                      | `eq neq gt gte lt lte between in not_in contains matches is_null …` |

`condition` accepts operator aliases (`is`, `is_any_of`, `before`, `on_or_after`, …) and coerces column types per value (`TRY_CAST` for numbers/dates). For array columns or explicit typing, register a tuned variant:

```ts
const filters = createFilterSet({
  targets: { where: $where },
  kinds: {
    tags: conditionFilterKind({ columnType: 'array' }), // list_has_any / list_has_all
  },
});
```

### Text and regex operators

`contains` / `starts_with` / `ends_with` (and their `not_*` forms) are case-insensitive `ILIKE` tests; `%`, `_` and `\` in the value match literally. `matches` / `not_matches` use DuckDB's `regexp_matches(column, pattern)`: the value is an RE2 pattern, case-sensitive unless it starts with `(?i)`. A pattern DuckDB cannot compile fails the query, so validate free-text patterns before writing them to a spec. An empty or non-string value leaves the spec inactive. A NULL column value is dropped by both a test and its `not_*` form, as with `ILIKE` / `NOT ILIKE`.

With `columnType: 'array'`, the same operator ids test the list's elements: the positive form keeps rows where **any element** matches (`len(list_filter(col, x -> <test>)) > 0`), and the `not_*` form keeps rows where **no element** matches.

```ts
filters.set({ id: 'tag', column: 'tags', kind: 'tags', operator: 'contains', value: 'beta' });
// (len(list_filter("tags", x -> x ILIKE '%beta%' ESCAPE '\')) > 0)
```

| list value         | `contains 'beta'` | `not_contains 'beta'` |
| ------------------ | ----------------- | --------------------- |
| `['alpha','Beta']` | kept              | dropped               |
| `['alpha']`        | dropped           | kept                  |
| `[]`               | dropped           | kept                  |
| `NULL`             | dropped           | dropped               |

NULL elements never match. Earlier versions rendered these operators as a scalar `ILIKE` on the list, which DuckDB rejects, so no filter that used to work changes meaning.

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
| `matches`         | matches regex         | `unary` |
| `not_matches`     | does not match regex  | `unary` |
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

For a composite key, pass `columns`: `subqueryFilterKind(build, { columns: ['domain', 'phrase'] })` emits `("domain", "phrase") IN (SELECT …)` with one `fields` entry per column, and `build` must select the columns in the same order. See [membership subqueries](./subquery-predicates.md#composite-keys) for how NULLs behave in a tuple.

Multi-target kinds return several emissions — e.g. a metric threshold emitting a HAVING clause to its own card and a membership subquery to everyone else (the library ships this one as [`aggregateThresholdFilterKind`](#aggregate-threshold-kind)):

```ts
const kind: FilterKind = {
  emit: ({ spec, column, contextPredicate }) => [
    // `havingPredicate` is an aggregate test (no input column) → `fields: []`.
    { target: 'having', clause: { predicate: havingPredicate, fields: [] } },
    { target: 'where', clause: { predicate: membershipPredicate } },
  ],
};
```

An emission's `clause.fields` (Mosaic 0.29+) lists the input expressions its predicate filters over; it defaults to the resolved `column` node, so a kind that tests that single column directly can omit it (as the `where` emission above does). Set it explicitly when the predicate references different or no columns, using the exact node instances the predicate holds. Subquery predicates never carry clause metadata (Mosaic's pre-aggregator only understands point/interval shapes).

## Aggregate threshold kind

`aggregateThresholdFilterKind({ from, aggregate, targets: { having, members }, operators? })` builds the "groups whose aggregate passes a threshold" kind: keep the `phrase` groups whose `max(search_volume)` is over 1000, on the widget that groups by `phrase` and on every widget around it. The group key is the spec's own `column`. Each active spec emits two clauses:

- `targets.having`: `<aggregate> <op> <value>`, with `fields: []` (an aggregate has no input column). Consume this target with `havingBy` on the widget that runs the grouped query.
- `targets.members`: `<column> IN (SELECT <column> FROM <from> WHERE <contextPredicate> GROUP BY <column> HAVING <aggregate> <op> <value>)`, with `fields` set to the outer column. Consume it with `filterBy` everywhere else. The `WHERE` is left out when there is no context. Because the kind reads `contextPredicate`, the set rebuilds the subquery when the context Selection changes.

```ts
import { aggregateThresholdFilterKind, createFilterSet } from '@nozzleio/mosaic-core';
import { max } from '@uwdata/mosaic-sql';

const filters = createFilterSet({
  targets: { where: $where, having: $having, members: $members },
  context: $page,
  kinds: {
    'volume-threshold': aggregateThresholdFilterKind({
      from: 'questions',
      aggregate: () => max('search_volume'),
      targets: { having: 'having', members: 'members' },
      operators: ['gt', 'lt'], // optional; defaults to every THRESHOLD_OPERATORS entry
    }),
  },
});

filters.set({
  id: 'volume',
  column: 'phrase', // the group key
  kind: 'volume-threshold',
  operator: 'gt',
  value: 1000,
});
// having:  (max("search_volume") > 1000)
// members: ("phrase" IN (SELECT "phrase" FROM "questions" WHERE <context>
//            GROUP BY "phrase" HAVING (max("search_volume") > 1000)))
```

- `from` is a table name (quoted as one identifier) or a mosaic-sql `TableRefNode` for a schema-qualified table.
- `aggregate` is a mosaic-sql node or a function returning one. Each emission gets its own node (a function is called once per emission, a node is deep-cloned), so the two clauses never share AST instances.
- `operators` are ids from the exported `THRESHOLD_OPERATORS` (`gt`, `gte`, `lt`, `lte`, typed as `ThresholdOperator`). The kind advertises them, in the order given, as its `operators` for pickers. A spec without an `operator` uses `gte`. A spec with an operator outside the list, or a `value` that is not a finite number, is inactive.
- Chips format as `> 1000`, `≥ 5`, and so on. `chip.target` is the `having` target, the first emission.
- `createFilterSet` does not check the target names. The factory throws if `having` and `members` are equal or empty, or if `operators` is empty or holds an unknown id.

## Computing a spec's clause without publishing it

Pinned per-widget filters, server-side prefilters, previews and tests often need "the clause this spec would publish" without going through a set. Do not rebuild it by hand. Use `emitFilterSpec` or `filterSpecPredicate`. FilterSet's own publish path calls the same code, so the result always matches what the set would publish:

```ts
import { emitFilterSpec, filterSpecPredicate } from '@nozzleio/mosaic-core';

const spec = { id: 'sport', column: 'sport', kind: 'points', value: ['judo'] };

emitFilterSpec(spec, { kinds: filters.kinds, defaultTarget: filters.defaultTarget });
// → [{ target: 'where', predicate, fields, value, meta: { type: 'point' } }]

const where = filterSpecPredicate(spec, { kinds: filters.kinds, target: 'where' });
Query.from('athletes')
  .select('*')
  .where(where ?? []);
```

- `emitFilterSpec(spec, { kinds?, contextPredicate?, defaultTarget? })` returns one `{ target, predicate, fields, value, meta? }` per resolved target, in the order the kind first emits each target. It applies the set's defaults (target resolution, `value` falls back to `spec.value ?? null`, `fields` falls back to the resolved column). If a kind emits to the same target twice, the last emission wins. `predicate: null` means the spec is inactive on that target. An empty array means the kind emitted nothing.
- `filterSpecPredicate(spec, { …, target? })` returns the predicate for one target, or `null`. With no `target`, it returns the primary target's predicate: the first emission with a non-null predicate, which is the same target `chip.target` reports.
- `kinds` is merged over the built-ins, the same way as on `createFilterSet`. `filterSet.kinds` is the set's merged registry (read-only, frozen), so passing it resolves a spec exactly the way that set does.
- `contextPredicate` is passed to the kind as-is and defaults to `null`. A set computes it from its context Selection. Here you supply it.
- These functions never warn about unknown targets: they do not know which Selections exist. That check, and the `having` warning, stay in the set. An unregistered kind throws, the same as `set()`.

## Publishing into the set

Widgets support two publish paths, both Mosaic-native — downstream consumers cannot tell who called `selection.update`:

- `publish: { into: filterSet, id }` — managed: the widget writes specs instead of clauses, so its filter shows up in chips, persistence, and serialized state. External removal of the spec mirrors back into widget state (selection cleared), and self-exclusion survives — the set attaches the widget's client to the published clauses, so `Selection.crossfilter()` semantics are unchanged. Across a remount (an enlarge/return move, or a StrictMode throwaway mount) a freshly-mounted client re-adopts the surviving spec and re-keys its clause to the new client; the re-keyed `clients` set reaches the composed filter context one dispatch later, so the client re-queries once its own clause is confirmed self-excluded there — never left filtered by its own selection. A client destroyed inside that deferred adopt window is a no-op (it never re-keys the clause to a dead client).
- `publish: { as: selection }` — direct: ephemeral viz interaction.

A `publish.into` target takes `{ into, id, kind?, label?, target? }`. `target` is written to the spec's `target`, so on a multi-target set it chooses which Selection the widget's clause lands on. Without it, the spec falls back to the set's `defaultTarget`. When a remounted widget re-adopts a spec that is already in the set, it republishes that spec unchanged, so the stored `target` is kept:

```ts
createFacetClient({
  /* … */
  publish: { into: filters, id: 'sport', target: 'members' },
});
```

The rule: **if the user should see it as "a filter", route it into the set; if it's transient brushing or linking, publish direct.** Facet, histogram, and rows clients accept both forms (`rows` on its `select` target only; hover is transient by definition). Client-level `persist` is ignored under `publish.into` — the set owns persistence.

```ts
const facet = createFacetClient({
  /* … */
  publish: { into: filters, id: 'sport' },
});
```

A chart the packages do not model (a custom-drawn time series, a third-party chart library) publishes the managed way by hand: `set()` an `interval` spec and pass the chart's own client as `set(spec, { clients: new Set([client.mosaicClient]) })`. That is the same self-exclusion association `publish.into` attaches. `clients` is session state: it is never persisted, and `remove(id)`/`reset()` drop it with the spec. See the [custom-chart brush recipe](../react/topology-recipes.md#custom-chart-brush) for the read-back, ISO-string temporal bounds, and re-keying the spec to a remounted client.

## Chips

`store.state.chips` derives from the specs — label from `label`/`column`, value formatted per kind (ranges join as `lo - hi`, arrays explode into one chip per value for multi-value kinds). `removeChip(chip)` narrows an exploded value or removes the spec; `reset()` clears the bar. Foreign clauses published directly onto the Selections are chip-invisible by design; the chip list derives from an iterable so a future adapter can contribute entries additively.

`chip.target` is the **resolved** routing target — where the kind's emission actually landed (`emission.target ?? spec.target ?? defaultTarget`), not the declared `spec.target`. A self-routing kind that overrides the target on every emission (e.g. metric-threshold → `having:<card>` + `members:<card>`) reports the resolved target on its chip, so a decorative `spec.target` is no longer needed to label such chips (and no longer silently lost on URL hydration). When a kind emits to multiple targets for one spec, `chip.target` is the deterministic primary: the first emission's resolved target in kind-declaration order. Exploded chips report the same resolved target as their parent spec. Before a spec has published an active clause, `chip.target` falls back to `spec.target ?? defaultTarget`.

In React, subscribe with `useFilterSetState(filters)` / `useFilterSetChips(filters)` from `@nozzleio/react-mosaic`.

Foreign clauses (transient vgplot brushes, direct-to-Selection `publish.as`) are chip-invisible here by design, but a [selection topology](./selection-topology.md) enumerates them on `topology.activeClauses`. To render one bar that unions FilterSet chips with those foreign clauses — the shape apps own — see the [active-filters recipe](../react/topology-recipes.md#active-filters--chips).

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

## `destroy()`

`destroy()` detaches the set's listeners and, by default, **clears every clause it published** from its targets — the right default when the targets outlive the set (page-scope Selections shared with other widgets). It never writes to the persister. Idempotent; `set.destroyed` reports it.

Clearing publishes a `value` update on each target, so a client still connected to a target may run one query on the way out. Clients that can pre-aggregate (or set `coalesceFilterBy: false`) run it at once; clients on the [coalesced path](./concepts.md#one-query-per-action) defer it to their next batch, which is dropped if the client is destroyed first — as it usually is when it is torn down alongside the set. When the targets die with the set — nothing will read them again — pass `{ silent: true }` to skip the clears: the targets keep their last clauses and emit nothing.

```ts
filters.destroy(); // detach, then clear published clauses (default)
filters.destroy({ silent: true }); // detach only — no clear, no `value` event, no query
```

A `filter-set` entry owned by a [topology](./selection-topology.md#teardown-is-silent) is torn down silently, because its target Selections are owned by the topology too.
