# `example-react-nozzle-paa`

The Nozzle PAA dashboard from the legacy example, replicated on the
data-client stack ([#165](https://github.com/nozzle/mosaic-adapters/issues/165)):
a KPI header (all four KPIs data-driven and cross-filtered), four
cross-filtering group-by summary tables — each with a metric-threshold
HAVING + membership filter on its computed column — a min-domains membership
subquery, top-bar facet/text/date inputs, an active-filter chip bar with
global reset, a sparkline column, a detail table with bridged column
filters, and per-widget SQL debug footers.

Data: the `nozzle_paa` table loads from
`https://fastopendata.org/nozzle_test.parquet` through a Vite proxy
(`/data-proxy`, CORS strip) into DuckDB-WASM.

## The topology (`src/page-context.ts`)

Unlike the athletes example's single `Selection.crossfilter()`, this page
composes a static graph of per-widget Selections with upstream-native
`Selection.intersect({ include })` lists. Peer-minus-self is **structural**:
each widget's context simply omits that widget's own output Selection.

Three things force this shape (and are worth stealing for similar pages):

1. **Per-source chips** — the filter registry labels and removes filters per
   input Selection; a single page Selection would blur them together.
2. **Remount-stable self-exclusion** — clause `clients` sets (the crossfilter
   exclusion mechanism) are bound to client _instances_; the summary tables
   remount on enlarge/collapse, so exclusion must not depend on them.
3. **Selective overlays** — each card's metric-threshold membership subquery
   filters every _other_ widget (siblings, detail table, inputs, KPIs) but
   deliberately **not** its own card, which applies the equivalent
   restriction through its own `havingBy`. That is just an include-list
   difference.

## Behaviors to poke at

- **Row-select cross-filtering** — click summary rows: siblings, the detail
  table, and the KPIs narrow; the table's own rows stay put, with
  non-matching rows dimmed via a consumer-side
  `max(CASE WHEN <own-selection> THEN 1 ELSE 0 END) AS __is_highlighted`
  column. In-widget chips and the chip bar both remove single values (the
  registry narrows the published `clausePoints`).
- **Enlarge / return** — selection state lives in module-scope Selections and
  survives the remount: the rows clients publish under stable clause sources
  (`publish.select.source`), so `destroy()` retains the clause and the next
  instance replaces it.
- **Metric thresholds** (every card's header strip; the legacy page had only
  the question card's "SERP Appears") — one (operator, value) input, two
  predicates: `HAVING <metric agg> >/< N` routed to the card via `havingBy`,
  plus a membership subquery embedding the card's own filter context,
  republished through `updateClauseIfChanged` so context rebuilds converge.
- **Min domains** — the filter-builder's `subquery` mode:
  `related_phrase.phrase IN (SELECT … GROUP BY 1 HAVING count(DISTINCT domain) >= N)`.
- **Clear All** — `filterRegistry.resetAll()`; every input syncs back,
  including TanStack detail-column filters via the bridge's
  `onExternalClear` write-back.
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

The suite ports the legacy `nozzle-paa.test.ts` assertions (selection cascade
with dataset literals, enlarge/return state survival, chip clearing, KPI
reactions, highlight dimming) and adds the SERP/min-domains membership
filters, the bridge external-clear behavior, facet count cascading, and the
SQL footers.
