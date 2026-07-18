# Selection topology

`createTopology(config, options?)` — turn a declarative config into resolvable, validated Selection instances. It is the **named-Selection-graph primitive**: a page names every Selection it runs on and how they relate, and each widget references the one it filters by _by name_ instead of importing a Selection instance.

Selections stay the runtime model. Creating them by hand (`useMosaicSelections`, `useComposedSelection`, `useCascadingContexts`, or bare `Selection.crossfilter()`) is still first-class — the topology resolver is implemented as calls to the same composition logic those hooks use. A topology adds one thing on top: a **name → Selection** map, so a spec-driven page can say `filterBy: 'detailContext'` in JSON and resolve it at mount.

The word "dashboard" appears only in the motivation. The library standardizes exactly one thing: the selection-topology fragment a larger, app-owned spec embeds. Whole-dashboard spec formats stay app-owned.

```ts
import { createTopology } from '@nozzleio/mosaic-core';

const topology = createTopology({
  where: { type: 'crossfilter' },
  brush: { type: 'single' },
  detailContext: { type: 'compose', include: ['where', 'brush'] },
});

const $detail = topology.resolve('detailContext'); // → Selection
```

In React, build it with [`useTopology`](../react/topology.md) and distribute it through a provider; this page is the framework-agnostic core.

## Config is data, options are code

A topology has two arguments, and the split is deliberate:

- **`config`** — a **pure JSON** document naming every Selection and how they relate. No functions, no instances. This is the part a hand-editor or a spec loader can author and round-trip.
- **`options`** — everything that is **code**, keyed by the names the config declares: `external` Selection instances (`options.selections`) and the code-only parts of a FilterSet (`options.filterSets[entry].kinds` / `.persist`).

The config is the **complete namespace document**: every name, including code-created ones, is declared there. A hand-editor sees every hole the code must fill, and `validNames` (below) is total.

```ts
const config = {
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
  brush: { type: 'external' },
};

const topology = createTopology(config, {
  selections: { brush: myVgplotBrush }, // the instance for the `external` entry
  filterSets: {
    filters: {
      kinds: { 'min-domains': minDomainsKind },
      persist: urlPersister,
    },
  },
});
```

## Declaration vocabulary

The config is a `Record<string, TopologyDeclaration>`. The declaration set is **closed** — there are no pluggable types; anything exotic goes through the `external` escape hatch. Every declaration is discriminated on `type`, so TypeScript owns structural validation with no schema library.

Most declarations resolve to a **Selection** — a set of clauses deciding _which rows pass_. Two of them, [`param` and `external-param`](#params), instead resolve to a Mosaic **Param** — a named reactive scalar deciding _which knobs exist_ (the metric a KPI aggregates, the grain a trend bins by). They are members of the same closed union, declared in the same JSON config, but resolve through a parallel accessor so `resolve` stays honestly typed `=> Selection`. See [Params](#params).

### Standalone

A single Selection of a fixed resolution strategy.

```json
{ "where": { "type": "crossfilter" } }
```

`type` is one of `'intersect' | 'union' | 'single' | 'crossfilter'` — the four `Selection.*()` constructors. Resolvable as the bare entry name (`where`).

### `compose`

A Selection mirroring the union of the clauses of every ref in `include`.

```json
{
  "detailContext": { "type": "compose", "include": ["where", "brush"] }
}
```

Each ref in `include` must resolve to a non-compound entry. The composed Selection is seeded with the included Selections' current clauses at construction (it reflects existing state, not just future updates) and relays their future updates. Derived — [skipped by `reset()`](#reset-semantics).

`as` (optional) picks the composite's resolution strategy — `'intersect'` (default) or `'crossfilter'`:

```json
{
  "page": {
    "type": "compose",
    "as": "crossfilter",
    "include": ["where", "brush"]
  }
}
```

Mosaic's per-client self-exclusion (a control not filtering by its own clause) is governed by the composite's cross flag: `as: 'crossfilter'` yields a composite that self-excludes its own publishers (a shared page context that must not filter by the control that wrote a clause), whereas the default `intersect` never self-excludes. See [self-excluding composites](#self-excluding-crossfilter-composites) below.

### `cascading`

Per-key peer-cascading contexts — the "each control filtered by every _other_ control, but not itself" pattern (avoiding the ghost-option bug).

```json
{
  "facets": {
    "type": "cascading",
    "keys": ["sport", "country"],
    "externals": ["where"]
  }
}
```

- `keys` are **refs to other declared selections** used as the cascading _inputs_. Each key becomes one addressable context: `facets.sport`, `facets.country`. A key must be a bare ref (no dot).
- `externals` (optional) are refs included in every context (e.g. the page's table filters).

Each context is an `intersect` Selection including every _other_ input plus all externals — never the key's own input. This mirrors the runtime `createCascadingContexts(inputs, externals)` signature. Compound entry: its **bare ref is a parse error** — address the children as `facets.<key>`. Derived — skipped by `reset()`.

### `filter-set`

A [FilterSet](./filter-set.md) whose declared `targets` each become an addressable target Selection.

```json
{
  "filters": {
    "type": "filter-set",
    "targets": { "where": "crossfilter", "having": "intersect" },
    "context": "page"
  }
}
```

- Each `targets` entry (name → resolution strategy) becomes a Selection resolvable as `filters.where`, `filters.having`, `filters.<yourTarget>`. The namespace is exactly the declared target keys — no synthetic names.
- `context` (optional) is a ref to a declared selection used as the FilterSet's subquery context (for context-dependent membership kinds).
- The **code-only** parts of `FilterSetOptions` — `kinds` (functions) and `persist` (a Persister) — are supplied via `options.filterSets[entry]`, keyed by entry name. Specs referencing custom kinds _by name_ still round-trip; only the kind _implementations_ are code.

Compound entry: bare ref is a parse error. Retrieve the constructed FilterSet with `topology.getFilterSet('filters')` (or `topology.filterSets.filters`) to call `set()` / `remove()` / subscribe to its store.

> A `filter-set` `context` ref that (transitively) includes the set's own targets is **supported directly** — the FilterSet's targets feed the context, and the context feeds the FilterSet, without tripping cycle detection (the `context` ref is a read edge, excluded from the structural cycle graph). Declare the context as an ordinary [`compose`](#compose) entry that includes the targets; add `as: 'crossfilter'` if it must self-exclude its publishers. See [self-referential filter-set contexts](#self-referential-filter-set-contexts-supported).

### `external`

An escape hatch: the Selection instance is supplied in `options.selections`, keyed by entry name.

```json
{ "page": { "type": "external" } }
```

```ts
createTopology(config, { selections: { page: Selection.crossfilter() } });
```

The library does not own an `external` instance (it is never destroyed by `destroy()`) and does not care where it came from — a vgplot brush, a hook-created Selection, a Selection from another topology, or a hand-wired crossfilter composite. The rule is **strict both ways**: an `external` declaration with no supplied instance throws, and a supplied instance with no `external` declaration throws.

### Base fields

Every declaration additionally accepts three optional fields:

| field   | type      | meaning                                                                              |
| ------- | --------- | ------------------------------------------------------------------------------------ |
| `label` | `string`  | Human-readable label, surfaced on annotated [active clauses](#active-clauses).       |
| `meta`  | `unknown` | Opaque passthrough, surfaced on active clauses. **The library never interprets it.** |
| `reset` | `boolean` | When `false`, [`reset()`](#reset-semantics) skips this entry. Defaults to `true`.    |

There is deliberately no initial `specs` field: topology is _structure_; specs are _state_ with their own serialization story (a FilterSet's `persist`).

## Ref grammar

Refs are dot-notation, **exactly one level deep**: `entry` or `entry.child`.

- `standalone` / `compose` / `external` resolve as a bare `entry`.
- `filter-set` targets resolve as `entry.targetName` (`filters.where`, `filters.myCustomTarget`) — the namespace is exactly the declared `targets` keys.
- `cascading` contexts resolve as `entry.key` (`facets.sport`).
- **A bare ref to a compound entry (`filters`, `facets`) is a parse error.** There is no "bare `filters` means `filters.where`" defaulting — spec-level `where` defaulting stays a FilterSet concern; the ref grammar stays explicit.
- Dots are **banned in entry names** (they are reserved for the `entry.child` grammar). A dot in an entry name throws at construction.

Types stay simple — `Array<string>`, `Record<string, SelectionType>`. There are no template-literal ref types or generic key inference; refs are plain strings validated at runtime.

## Validation is construction

There is no validation subsystem. `createTopology` **asserts as it builds and throws a plain `Error` on the first violation**:

- an unknown declaration `type`;
- a dot in an entry name;
- a dangling ref (points at an undeclared entry);
- a bare ref to a compound entry;
- a dependency cycle (reported with the path, e.g. `a → b → a`, caught naturally by the recursive resolution walk);
- an `external` entry with no supplied instance;
- a supplied instance with no `external` declaration.

Construction builds every entry eagerly, so all of the above surface at `createTopology` time, not lazily at first `resolve`.

After construction succeeds, `resolve(ref)` can only fail on a **never-declared ref** (a widget-spec typo) or a bare-compound ref. Both errors list the topology's `validNames`.

```ts
const topology = createTopology({ where: { type: 'crossfilter' } });

topology.validNames; // Set { 'where' }
topology.resolve('where'); // → Selection
topology.resolve('wehre'); // throws: lists validNames
```

### `validNames` is for the app layer

`validNames` is a `Set<string>` of every resolvable ref — every bare simple entry plus every dotted child, **including every [`param` / `external-param`](#params) entry**, so the app validates knob refs exactly as it validates filter refs. The library validates the topology fragment; the **app** validates its own widget references into it. A spec loader checks each widget's `filterBy` ref against `topology.validNames` before mount, so a typo in a hand-edited spec is caught at the app boundary with the app's own error, not deep inside a query.

```ts
for (const widget of dashboardSpec.widgets) {
  const ref = widget.inputs?.data?.filterBy;
  if (ref !== undefined && !topology.validNames.has(ref)) {
    throw new Error(
      `Widget '${widget.id}' references unknown selection '${ref}'.`,
    );
  }
}
```

## `reset()` semantics

`topology.reset()` is a **type-aware** page reset, driven by the declaration types — which already encode ownership:

- `standalone` and `external` entries have their clauses cleared (each clause is cleared by publishing a null-predicate clause from its own source).
- `filter-set` entries delegate to `filterSet.reset()`, so specs and chips stay consistent.
- `compose` and `cascading` are **skipped** — they are derived; resetting their inputs is both sufficient and the only correct semantics.
- `param` entries are restored to their declared `default`; `external-param` entries are **skipped** (the topology holds no baseline for a caller-owned instance). See [Params](#params).

Any declaration with `reset: false` is skipped, whatever its type — e.g. a scope selection that must survive a "clear all", or a derived `external` read-context that holds no clauses of its own.

```ts
const topology = createTopology({
  where: { type: 'crossfilter' }, // cleared
  scope: { type: 'single', reset: false }, // survives
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } }, // filterSet.reset()
});

topology.reset();
```

See the [page-wide reset recipe](../react/topology-recipes.md#page-wide-reset).

## Active clauses

`topology.activeClauses` is a subscribable [`@tanstack/store`](https://tanstack.com/store) `Store` of the **foreign** active clauses across the topology's Selections, each annotated with its owning entry. It is the observation half of the topology object (`reset()` is the action half). Read `state.clauses`, subscribe via `subscribe`, or in React use [`useTopologyActiveClauses` / `useMosaicActiveClauses`](../react/topology.md#active-clause-hooks). [Params](#params) never appear here — a param carries a value, not clauses, so there is nothing to annotate.

Each entry is an `ActiveClause`:

```ts
interface ActiveClause {
  entry: string; // the owning entry name (bare, never a dotted ref)
  ref: string; // the ref the clause's Selection resolves as
  label: string | undefined; // the declaration's `label`
  meta: unknown; // the declaration's opaque `meta`
  clause: {
    source: ClauseSource;
    value: unknown;
    predicate: ExprNode | null;
  };
}
```

"Foreign" means: clauses on topology-owned Selections that a FilterSet the topology built did **not** source. This dedup is **core-owned**: a `filter-set` entry's targets are topology nodes, so naive enumeration would re-report every spec-derived clause as if it were foreign. Because the topology _constructed_ the FilterSet, it knows those sources (`filterSet.ownsClauseSource`) and excludes them — leaving exactly the genuinely foreign set: transient vgplot brushes, and direct-to-Selection `publish.as` clauses.

Two more properties of the store worth knowing when building a chip recipe over it:

1. **`compose` / `cascading` contexts are excluded from enumeration** — they are derived mirrors of their inputs, so enumerating them would double-count. The store observes standalone, external, and filter-set-target Selections only. Declare a shared crossfilter read-context as a [`compose`](#compose) entry (rather than an `external` hand-wired composite) and its relayed clauses stay out of the store, so each foreign clause surfaces exactly once on its base source with no app-side dedup. See the [active-filters recipe](../react/topology-recipes.md#active-filters--chips) — the reference implementation is in [`examples/react/nozzle-paa/src/components/active-filter-bar.tsx`](../../examples/react/nozzle-paa/src/components/active-filter-bar.tsx).
2. **An observed `external` composite that _relays_ a base selection double-reports.** An `external` read-context is observed (unlike `compose`), so a foreign clause relayed into it is reported **once per sighting** — once on the base source, once on each observed `external` context it reached. Prefer a `compose` entry (property 1) to avoid this; if an `external` composite is unavoidable, an app-side chip recipe must dedup by clause source.

**Clearing a foreign clause clears the _whole_ clause** — publish a null predicate from the clause's own source. Per-value narrowing / write-back stays app-side (a FilterSet concern). Note that Mosaic's `Selection.remove(source)` does **not** clear a `single` Selection's clause, so the null-predicate publish is the reliable form across every resolution type:

```ts
import { clauseNone } from '@uwdata/mosaic-core';

topology.resolve(active.ref).update(clauseNone(active.clause.source));
```

`clauseNone(source)` (Mosaic 0.29+) is the canonical clear clause — `{ source, value: null, predicate: null, fields: [] }`. Hand-roll that literal only when the clear clause must also carry `clients`, which `clauseNone` does not accept.

There is **no chip model in the package** — no chip shapes, groups, or label maps. That union of FilterSet chips and foreign clauses is a few lines of app code over two subscribable sources, and its shape is exactly where apps differ, so it lives in the [recipes](../react/topology-recipes.md) and example apps only.

## `destroy()`

`topology.destroy()` tears down every composition and FilterSet the topology created and unsubscribes all its clause listeners. **`external` instances are never destroyed** — the topology does not own them. Idempotent; `topology.destroyed` reports it (the React binding uses this for StrictMode remount detection). Calling `reset()` or reading `activeClauses` after `destroy()` is a safe no-op.

## Params

The topology models a second axis of page state alongside **which rows pass** (Selections and their clauses): **which knobs exist** — the named reactive scalars that shape _what a query computes_ rather than _which rows survive it_: the metric column a KPI aggregates, the date grain a trend bins by, the top-N a bar chart cuts at. In Mosaic those are `Param`s, not `Selection`s. A param enters a query by **value interpolation** — its current value is spliced into the SQL as a literal at codegen — never as a `WHERE` / `HAVING` predicate.

`param` and `external-param` are two more members of the same closed [declaration vocabulary](#declaration-vocabulary), declared in the same JSON config and validated the same way. They resolve through a **parallel** accessor (`resolveParam` / `params`) that returns a `Param`, leaving `resolve` honest as `=> Selection`.

> Mosaic's `Selection extends Param`: a Selection _is_ a Param whose value is its clauses' predicate. The topology already builds the specialized subclass; params simply add the base class. Because of that inheritance a Selection would type-check as a Param, but `resolveParam` still rejects selection refs (below) so `params` means "the scalar knobs," not "every node."

### Declaring a param

A **`param`** is topology-owned — constructed as `Param.value(default)` and torn down by [`destroy()`](#destroy). `default` is **required** and must be JSON-serialisable: it is to a param what a target's resolution strategy is to a [`filter-set`](#filter-set) target — a fixed, hand-authorable property of the node, not its live contents — which is what keeps the config a pure JSON document.

```json
{ "metric": { "type": "param", "default": "gold" } }
```

`default` (and every value the param later holds) ranges over `ParamValue` — a JSON scalar or a flat array of them:

```ts
type ParamValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;
```

That is exactly the set Mosaic interpolates: a metric name, a grain string, an N, a boolean toggle, a multi-select of scalars.

An **`external-param`** is the escape hatch — the exact mirror of [`external`](#external) for selections. The instance is supplied in `options.params`, keyed by entry name; the library never owns it (never reset, never destroyed):

```json
{ "grain": { "type": "external-param" } }
```

```ts
import { Param } from '@uwdata/mosaic-core';

createTopology(config, { params: { grain: Param.value('day') } });
```

The symmetry is **strict both ways**, byte-for-byte the checks [`external`](#external) runs: an `external-param` declaration with no supplied instance throws, and an instance in `options.params` with no matching `external-param` declaration throws.

> `options.params` here is the topology options bag — unrelated to a client's `DataClientOptions.params`. A topology-owned `param` never appears in `options.params` (the topology built it); it flows to a client through `resolveParam`. See [handing a param to a client](#handing-a-param-to-a-client).

### Resolving params

`resolveParam<T>(ref)` returns the `Param<T>` for a bare entry, and `topology.params` is the eager `name → Param` record — the exact mirror of [`getFilterSet` / `filterSets`](#filter-set). Param entries also appear in [`validNames`](#validnames-is-for-the-app-layer). The `T` type parameter defaults to `any`, so `resolveParam<MedalMetric>('metric')` types the result at the call site without a cast (a caller-side assertion — the heterogeneous `params` record is not verified against it).

```ts
const topology = createTopology({
  where: { type: 'crossfilter' },
  metric: { type: 'param', default: 'gold' },
});

topology.resolveParam('metric'); // → Param
topology.params.metric; // → the same Param
topology.validNames; // Set { 'where', 'metric' }
```

The two resolvers are **guarded against each other**, so each keeps an honest return type instead of a widened `Param | Selection` the caller must narrow:

- `resolve('metric')` throws, naming `resolveParam` as the correct call;
- `resolveParam('where')` throws, pointing back at `resolve`.

Param refs are **bare entries only** — a param is a leaf with no children, so `entry.child` is never a valid param ref (`resolveParam('metric.foo')` throws).

### Params are leaves

A param carries a value, not clauses, so it cannot sit on any clause-composition edge. Construction rejects a param ref (validation-is-construction) wherever a clause source is expected, naming the offending edge:

- in a [`compose`](#compose) `include` — a composite mirrors _clauses_; a param has none;
- in [`cascading`](#cascading) `keys` or `externals` — same reason;
- in a [`filter-set`](#filter-set) `context` — a context is a subquery-predicate source.

Two consequences fall out of leaf-ness:

- **Excluded from [`activeClauses`](#active-clauses).** That store enumerates Selection clauses; a param has none to annotate.
- **No relay wiring.** Params never allocate a relay edge, so they take no part in the two-phase compose construction.

### Param `reset()` and `reset: false`

[`reset()`](#reset-semantics) restores each owned **`param`** entry to its declared `default` — the param equivalent of clearing a standalone selection's clauses. **`external-param`** entries are **skipped**: the topology holds no baseline for a caller-owned instance (a plain clear is baseline-agnostic, but "reset to default" needs a default the topology does not have). `reset: false` opts any param out of the sweep, whatever its type — same as every other entry.

### Persisting a param's value

The declared `default` is _structure_; the live value is _state_, and it persists through the existing [`Persister<T>`](./filter-set.md) contract — no new mechanism — supplied per owned entry in `options.paramOptions[entry].persist`:

```ts
const topology = createTopology(
  { metric: { type: 'param', default: 'gold' } },
  { paramOptions: { metric: { persist: metricParamPersister } } },
);
```

The hydration rule is identical to filter defaults: at construction a **non-nullish persisted value hydrates the param and wins over `default`**; a nullish read leaves the param at `default`. Every subsequent value change — including `reset()`'s restore-to-default — writes through the param's `'value'` event, and the hydration echo is suppressed by the same `PersisterLifecycle` guard filter clients use.

Persistence applies to **topology-owned `param` entries only**. Supplying `paramOptions` for any other entry — including an `external-param`, whose live value is the caller's to persist — is a construction error.

### Handing a param to a client

A declared param reaches a query by being handed to a client in that client's own `params` map (`DataClientOptions.params`) — the re-query wiring that fires exactly one coalesced re-query on a param's `'value'` event (upstream Mosaic never re-queries on a param change; that is first-class here). The topology _declares and owns_ the param; the client _subscribes_ to it. Look it up by name and pass it through, end to end:

```ts
import { createTopology, createValuesClient } from '@nozzleio/mosaic-core';
import { Query, column, sum } from '@uwdata/mosaic-sql';

const topology = createTopology({
  where: { type: 'crossfilter' },
  metric: { type: 'param', default: 'gold' },
});

const $where = topology.resolve('where');
const $metric = topology.resolveParam('metric');

const kpis = createValuesClient<{ medals: number }>({
  coordinator,
  query: ({ where }) =>
    Query.from('athletes')
      .select({ medals: sum(column($metric.value!)) })
      .where(where),
  filterBy: $where,
  params: { metric: $metric }, // re-queries whenever the param's value changes
});
```

The two `params` surfaces stay separate: `options.params` on `createTopology` binds `external-param` _instances_; `params` on a client lists the Params that client's query _reads_. The topology declares and owns the param; the client subscribes to it; the responsibilities never merge.

In React, resolve the param off the provider with [`useMosaicParamRef`](../react/topology.md#usemosaicparamref) and read its live value with [`useMosaicParamValue`](../react/hooks.md#param-read-back). A widget that _publishes_ into a param (an input) and then _mints a clause_ from it is app code the packages deliberately do not ship — see the [param → selection bridge recipe](../react/topology-recipes.md#param--selection-bridge).

## Composite strategies and the escape hatch

The declarative form covers the common graph shapes directly — including self-excluding crossfilter composites (`as: 'crossfilter'`) and self-referential filter-set contexts (both below). For anything it still does not model, declare the entry `external` and wire it in app code — the sanctioned escape hatch, with the config still naming every hole so `validNames` stays total.

### Self-excluding (crossfilter) composites

A `compose` declaration yields an `intersect` composite by default. Mosaic's per-client self-exclusion — a facet or summary control not filtering by its own clause — is governed by the composite's cross flag: `crossfilter.predicate(ownClient)` returns `undefined` (excluded), whereas `intersect.predicate(ownClient)` still returns the client's own predicate (not excluded).

Set `as: 'crossfilter'` on the declaration to get a self-excluding composite — a shared page context that must not filter by its own publishers is a plain `compose` entry:

```ts
const config = {
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
  spotlight: { type: 'single' },
  // Self-excludes each clause's own clients; includes are seeded and relayed.
  page: {
    type: 'compose',
    as: 'crossfilter',
    include: ['filters.where', 'spotlight'],
  },
} as const;

const topology = createTopology(config);
```

Self-exclusion is a property of the composite a client _reads_, so it is never inherited from includes: an `intersect` compose that includes a `crossfilter` compose does **not** self-exclude for its own readers. The standalone `createComposedSelection(selections, { as: 'crossfilter' })` takes the same option.

### Self-referential filter-set contexts (supported)

A `filter-set` entry whose `context` ref (transitively) includes the set's own targets is **supported directly**. The FilterSet's targets feed the context (for membership subqueries), and the context feeds the FilterSet (as its subquery context) — a shape that once tripped construction-order cycle detection.

`createTopology` builds `compose` entries in two phases: it first allocates every compose's (empty) Selection, then, once all entries exist, resolves each compose's includes and wires the relays (attaching all relays before seeding any, so a nested compose's pre-existing clauses are never dropped). Cycle validation runs over the declaration graph with the filter-set `context` ref **excluded** — it is a read edge (the FilterSet consumes its context by clause-source identity), not a relay/build edge. Compose↔compose cycles, compose self-includes, and cycles routing through a compose via cascading are still rejected.

So the previously-required escape hatch is gone: declare the context as an ordinary `compose` entry that includes the FilterSet's targets. To make that context self-exclude its publishers, add `as: 'crossfilter'` (see below).

## Standalone composition factories

The two composition primitives the topology builds on are exported directly, for graphs assembled outside a topology (or inside a React lifecycle via the [hooks](../react/hooks.md#topology-helpers)). Both return a handle with a `destroy()` — they wire relay listeners that must be torn down.

```ts
import {
  createComposedSelection,
  createCascadingContexts,
} from '@nozzleio/mosaic-core';

// One Selection mirroring the union of the given Selections' clauses.
// `as: 'crossfilter'` makes it self-exclude each clause's own clients.
const composed = createComposedSelection([$where, $brush], { as: 'intersect' });
composed.selection; // → Selection
composed.destroy(); // detach relays, clear seeded clauses (idempotent)

// Peer-minus-self contexts: each key's context includes every OTHER input
// plus the externals, never the key's own input.
const cascading = createCascadingContexts(
  { sport: $sport, country: $country },
  [$where],
);
cascading.contexts.sport; // → Selection (sees country + where, not sport)
cascading.destroy();
```

These are the same factories the `useComposedSelection` / `useCascadingContexts` hooks call; `createTopology` wires composes with the same `wiring.ts` primitives, so declared and hand-written topology behave identically.

## See also

- [React topology bindings](../react/topology.md) — `useTopology`, the provider/consumer hooks, `useMosaicSelectionRef`, and the active-clause hooks.
- [Topology recipes](../react/topology-recipes.md) — page-wide reset and the active-filters / chips union.
- [Filter set](./filter-set.md) — the serializable filter-spec primitive a `filter-set` entry wraps.
- [`examples/react/nozzle-paa`](../../examples/react/nozzle-paa) — the reference implementation: a hoisted config with custom kinds, a URL persister, declared `as: 'crossfilter'` compose read-contexts (including a self-referential filter-set context), and the active-filters recipe.
