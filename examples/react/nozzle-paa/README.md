# `example-react-nozzle-paa`

The Nozzle PAA dashboard from the legacy example, replicated on the
data-client stack ([#165](https://github.com/nozzle/mosaic-adapters/issues/165)):
a KPI header (all four KPIs data-driven and cross-filtered), four
cross-filtering group-by summary tables — each with a metric-threshold
HAVING + membership filter on its computed column — a min-domains membership
subquery, top-bar facet/text/date inputs, an active-filter chip bar with
global reset, a sparkline column, a detail table with bridged column
filters, per-widget SQL debug footers, and shareable-URL filter persistence.

Data: the `questions` table loads from `/data/questions.parquet` — served from
the app's own origin — into DuckDB-WASM. The dataset is vendored in the repo
under `media/data/questions.parquet` and symlinked into `public/data`, so it
loads locally in dev and is copied into the build (no network fetch, no CORS).

## One FilterSet owns every filter (`src/page-context.ts`)

Every dashboard filter — top-bar text/date/min-domains, facet picks, summary
row selections, per-card metric thresholds, detail column filters — is a plain,
JSON-serializable `FilterSpec` on a single page-level `filterSet`
(`createFilterSet`). The set owns clause publication, routing targets,
self-exclusion `clients`, the chip list, and global reset; the components only
read its store and call its mutators (`set` / `remove` / `reset` / `removeChip`).

A `FilterSpec` is the serializable state — `{ id, column, kind, operator?,
value?, valueTo?, target?, label? }`. The `kind` names a resolver that turns the
spec into one Selection clause per target:

- Built-in kinds cover the common shapes: `point`, `points`, `interval`,
  `match`, `condition`. Text inputs write `match`/`contains`; the date range
  writes an `interval`; facets write `point` (single), `points` (multi), or
  `condition`/`list_has_any` (array columns); summary row selections write a
  `points` envelope.
- **Custom kinds** are registered in `createFilterSet({ kinds })`. This example
  ships two:
  - `min-domains` (`subqueryFilterKind`) —
    `related_phrase.phrase IN (SELECT … GROUP BY 1 HAVING count(DISTINCT domain) >= N)`.
  - `metric-threshold` — one `metric:<card>` spec emits **two** clauses to two
    named targets: a `HAVING <agg> >/< N` on the card's own grouped query
    (`having:<card>`) and a membership subquery narrowing every sibling
    (`members:<card>`). Reading `args.contextPredicate` embeds the page's filter
    context into the subquery and registers the spec for context rebuilds.

### Selection topology

The set routes clauses onto native Mosaic Selections declared at module scope:

- `$where = Selection.crossfilter()` — the shared WHERE target for text, date,
  min-domains, facets, summary rows, and detail filters. Per-widget
  self-exclusion is clause-`clients` based (wired by `publish.into`).
- `$having[card]` × 4 — a card's own metric HAVING, wired via `havingBy`.
- `$members[card]` × 4 — a card's membership subquery, seen by its siblings.
- `$page = Selection.crossfilter({ include: [$where, ...all members] })` — the
  everything-composite: `filterBy` for KPIs, the detail table, facets, and the
  sparkline, and the set's `context`.
- `summaryFilterBy[card]` — the page minus the card's own membership overlay.

Composed contexts **must** be `Selection.crossfilter({ include })`, never
`intersect`: per-client clause exclusion (facet/summary self-exclusion) is
governed by the outer composite's cross flag, so an `intersect` composite would
silently disable it.

### Chips

`active-filter-bar.tsx` reads `useFilterSetChips(filterSet)` — one chip per spec
(or per element for exploded `points`/row-selection values). Removing a chip is
`filterSet.removeChip(chip)` (exploded chips narrow the value; others remove the
spec); "Clear All" is `filterSet.reset()`. The bar groups chips consumer-side by
spec-id prefix to preserve the global → summary → detail ordering.

## Shareable URLs (`src/filter-url.ts`)

The set is created with `persist: urlPersister`, a consumer-owned
`Persister<FilterSpec[]>` that mirrors the whole filter state into
`location.search`. Because the set is module-scope, its synchronous `read()`
runs before the first query, so opening a link hydrates the dashboard with zero
flash — the KPIs and tables paint already filtered.

**What is encoded** — one search param per active spec, prefixed `f.` and keyed
by the spec id. Untouched filters have no param; foreign params (anything not
`f.`-prefixed) are preserved across writes. The value half is human-readable:

| Param                                          | Spec                            |
| ---------------------------------------------- | ------------------------------- |
| `f.text:phrase=coleman`                        | a `match`/contains string       |
| `f.date:requested=2024-01-01..2024-01-31`      | an ISO `lo..hi` interval        |
| `f.minDomains=4`                               | the min-domains threshold       |
| `f.facet:domain=reddit.com`                    | a single-select facet           |
| `f.facet:keyword-group=a,b`                    | a multi-value list              |
| `f.metric:question=gt:5000`                    | a metric threshold (`op:value`) |
| `f.select:phrase=gaz%20stove,gasoline%20stove` | a row-selection points spec     |
| `f.detail:question=coleman`                    | a bridged detail column filter  |

A declarative table maps each known spec id (or `<prefix>:*` family) to its
static parts (column, kind, fixed operator, label, target); the URL carries only
the dynamic parts. On read the codec reconstructs the full spec and hands it to
the set, which validates again — malformed or unknown params are skipped
defensively.

The detail-table example is worth calling out: a `detail:<column>` param
hydrates before the detail table mounts, and the TanStack bridge's adoption path
picks the spec up and drives the column input — so both the query _and_ the
TanStack UI reflect the shared state.

### Router note

This example is **router-less by design**, so `urlPersister.write` always uses
`history.replaceState` for every reason. A real app should instead drive the
filter setters _from_ its router's reactive search params (that is the
back/forward answer) and map the persister's `write` `reason` to push vs replace
navigation — see [`docs/react/router-persistence.md`](../../../docs/react/router-persistence.md).

## Behaviors to poke at

- **Row-select cross-filtering** — click summary rows: siblings, the detail
  table, and the KPIs narrow; the table's own rows stay put, non-matching rows
  dim via a consumer-side
  `max(CASE WHEN <own-selection> THEN 1 ELSE 0 END) AS __is_highlighted`
  column. In-widget chips and the chip bar both narrow single values.
- **Enlarge / return** — selection state lives on the module-scope set and
  survives the remount: the rows client republishes the same `select:<card>`
  spec, and the bridge/set keep the clause stable.
- **Metric thresholds** — one `(operator, value)` input per card, two
  predicates (own HAVING + sibling membership subquery), republished on context
  changes so the subquery converges.
- **Clear All** — `filterSet.reset()`; every input syncs back (it reads its spec
  from the store), including TanStack detail-column filters via the bridge's
  external-change write-back.
- **Shareable URLs** — filter, then copy the address bar; open it in a new tab
  and the dashboard hydrates to the same filtered state.
- **SQL footers** — every widget's `<details>` reads the public `lastQuery`
  from its client store.

## Run it

```bash
pnpm --filter example-react-nozzle-paa dev
```

## E2E

```bash
pnpm --filter example-react-nozzle-paa test:e2e
```

`tests/questions.test.ts` ports the legacy assertions (selection cascade with
dataset literals, enlarge/return state survival, chip clearing, KPI reactions,
highlight dimming) plus the metric/min-domains membership filters, the bridge
external-clear behavior, facet count cascading, and the SQL footers.
`tests/share-loop.test.ts` covers the URL persistence loop: UI edits writing
per-entry params, links hydrating to pinned table/KPI values, a summary
row-selection round-trip into a fresh page, chip removal clearing a single
param, and mid-state reload survival.
