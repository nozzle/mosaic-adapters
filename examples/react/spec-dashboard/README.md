# `example-react-spec-dashboard`

A YAML-spec-driven dashboard where the app is a **pure interpreter**. The entire
page — data tables, the cross-filter topology, filter behaviors, the filter
builder, KPI cards, a vgplot histogram with a drag brush, group-by summary
tables, and a detail table — is described by a single spec file
(`public/spec/questions.yaml`) fetched at runtime, parsed, and validated by a
zod schema defined entirely in this example (`src/spec/schema.ts`). Swap the
YAML and you get a different dashboard; the code in `src/` never changes.

A small manifest (`public/spec/manifest.json`) lists the available specs, and a
quick-load selector in the header switches between them (see "Spec manifest +
quick-load" below).

The reference content is the `nozzle-paa` People Also Ask dashboard, but that is
a property of the _spec_, not the app: every domain name lives in the YAML.

## Feature bullets

- **The spec is the dashboard.** Five sections (`data`, `topology`,
  `filter_kinds`, `filters`, `widgets` + `layout`) declare everything. Nothing
  about the page is hardcoded.
- **Domain-blind by construction.** No PAA vocabulary appears in `src/`; every
  domain name lives in the YAML (see below).
- **Four generic renderers.** Widgets are keyed by a generic `renderer:` string
  (`kpi-card`, `selection-table`, `data-table`, `vgplot`), never a bespoke
  widget type.
- **An app-owned plot DSL.** The vgplot widget interprets a declarative
  `plot:` node (marks / encodings / selects / semantic attributes) — the plot's
  _geometry_ is the renderer's concern, never the spec's.
- **Generic filter behaviors.** A `filter_kinds:` section instantiates behavior
  factories (currently `aggregate-threshold`) with config.
- **Cross-filter opt-out.** A widget that omits `filter_by` never joins the
  topology; the `kpi_phrases_all` card stays constant while every sibling reacts.
- **A live spec editor.** Edit the YAML and re-apply it in place.
- **Grafana-flavored theme that follows the system `prefers-color-scheme`.**
  Semantic surface/text tokens (`bg-panel`, `text-ink`, `border-line`, …) are
  registered into Tailwind's `@theme`; their values are CSS custom properties
  that flip on `prefers-color-scheme`, so no `dark:` variants and no in-app
  toggle are needed. The Grafana accent + categorical viz palette (`gf-*`) is
  identical in both themes.

## Run it

```sh
pnpm --filter example-react-spec-dashboard dev
```

## Spec manifest + quick-load

The set of available specs is itself **data**: `public/spec/manifest.json` lists
them, and the app fetches it before anything else. Its shape (zod-validated in
`src/spec/compile.ts`) is:

```json
{
  "default": "questions",
  "specs": [
    {
      "id": "questions",
      "label": "People Also Ask (questions)",
      "url": "/spec/questions.yaml"
    },
    {
      "id": "protein-design",
      "label": "Protein Design",
      "url": "/spec/protein-design.yaml"
    }
  ]
}
```

The boot flow is:

1. Fetch + validate the manifest.
2. Resolve the active spec **id** from the `?spec=` URL search param (plain
   `URLSearchParams` — there is no router). An absent param, or one naming an
   unknown id, falls back to the manifest `default`; `questions` is the launch
   selection.
3. Fetch that entry's `url` (its YAML) and compile it exactly as before.

A labeled quick-load `<select>` (`data-testid="spec-select"`) in the header lists
the manifest specs. Changing it writes `?spec=<id>` via `history.replaceState`
and loads that spec **fresh** — replacing the editor's `text`/`originalText` and
bumping the remount revision. This is a spec **switch**, not an Apply, so any
unsaved editor edits are intentionally discarded. Because every id/label/url
comes from the manifest (data, never hardcoded in `src/`), the app stays
domain-blind.

## The interpreter principle

The spec is **data**; the behavior it names lives in **code**, behind
name-keyed registries. The interpreter binds spec strings to registry entries
and fails loudly (at compile time) when a name has no binding:

| In the spec (data)                 | In code (registry)                                           |
| ---------------------------------- | ------------------------------------------------------------ |
| widget `renderer`                  | `widgetRegistry` (`src/widgets/registry.tsx`)                |
| kpi-card `format`                  | `formatterRegistry` (`src/widgets/formatters.ts`)            |
| filter placement / kind `behavior` | `kindRegistry` (`src/spec/kinds.ts`, builtins + spec)        |
| topology entry `type` / refs       | `useTopology` + `topology.validNames`                        |
| plot `mark` / `select` / encoding  | plot interpreter vocabulary (`src/spec/plot-interpreter.ts`) |

No domain knowledge lives in `src/`: all PAA vocabulary
(`phrase`, `search_volume`, `device`, …) stays in `public/spec/*.yaml`, so
swapping the YAML swaps the dashboard without touching a line of `src/`.

## The five spec sections

```yaml
title: People Also Ask Report # optional; header falls back to a generic default

data: # ordered CREATE OR REPLACE TABLE sources
  tables:
    questions: { type: parquet, url: /data/questions.parquet }
    questions_enriched: # derived table — pre-computes a volume_bucket column
      type: sql
      query: SELECT *, CASE … END AS volume_bucket FROM questions

topology: # → useTopology (Selections + the filter set)
  filters:
    { type: filter-set, targets: { where: crossfilter, … }, context: page }
  page:
    {
      type: compose,
      as: crossfilter,
      include: [filters.where, volume_brush, …],
    }

filter_kinds: # generic behavior factories instantiated with config
  metric_threshold:
    behavior: aggregate-threshold
    config:
      {
        table: questions_enriched,
        group_by: phrase,
        aggregate: 'max(search_volume)',
        …,
      }

filters: # the filter-builder field catalog (the only filter UI)
  fields:
    - id: phrase
      label: Phrase
      column: phrase
      value_kind: text
      placements:
        [{ label: WHERE, target: where, kind: condition, spec_id: text:phrase }]

widgets: # a map keyed by widget id; `renderer` selects the widget registry entry
  kpi_phrases:
    { renderer: kpi-card, filter_by: page, query: { type: sql, statement: … } }

layout: # a CSS grid: rows of { ref, span } widgets
  columns: 5
  rows: [{ widgets: [{ ref: kpi_phrases, span: 1 }, …] }, …]
```

- **`data`** — record insertion order is load order, so a derived `type: sql`
  table can reference tables declared before it. The connector is app policy
  (see below).
- **`topology`** — passed through (after validation) to `useTopology` as a
  `TopologyConfig`. Every composed read-context is `crossfilter`, never
  `intersect`: only crossfilter supplies the per-client self-exclusion the
  facet/summary controls rely on.
- **`filter_kinds`** — see "Filter behaviors" below.
- **`filters`** — each field lists `placements`, one per routing target; a
  placement pairs a FilterSet `target` with the `kind` (and operator vocabulary)
  the block uses.
- **`widgets`** — a **map keyed by widget id** (like `topology` and
  `filter_kinds`): the key IS the id and `renderer` is the per-widget
  discriminator into the widget registry. `filter_by` / `having_by` name topology
  Selections by ref; **omitting `filter_by` opts a widget out of the topology
  entirely** (the opt-out KPI).
- **`layout`** — a widget's `span` maps to a static Tailwind `col-span` class.

`compile.ts` builds a throwaway topology purely to read `validNames` + run the
library's structural validation, then `validate.ts` (`src/spec/validate.ts`)
cross-reference-checks every `renderer` / `format` / `kind` / `filter_by` /
`having_by` / plot ref / layout ref against the registries and reports **all**
violations at once. An invalid _initial_ spec renders its errors with no
dashboard; an invalid _editor_ apply keeps the last-good dashboard running.

## The two query forms

Widget queries (`src/spec/query-compiler.ts`) come in two shapes, discriminated
on `query.type`:

- **Raw template (`type: sql`)** — a SQL statement carrying `{{where}}` /
  `{{having}}` placeholders. At query time the incoming cross-filter predicates
  (`ctx.where` / `ctx.having`, mosaic-sql `ExprNode`s) are stringified to SQL,
  substituted into the placeholders, and the whole statement is wrapped as a
  subquery — `SELECT * FROM (<statement>)`. **The wrapping is load-bearing:** it
  lets the rows client's append mode attach its own `ORDER BY` / `LIMIT` /
  `OFFSET` to the outer query without touching the author's SQL (including an
  author-supplied trailing `ORDER BY` / `LIMIT`, which stays inside the
  subquery). An empty/absent predicate renders as `TRUE`, so a placeholder
  always substitutes into valid SQL. Used by the KPI and summary renderers.
- **Structured (`type: select`)** — an alias→expression map over a base table,
  compiled with `Query.from(from).select(…).where(ctx.where)` plus optional
  static `where` / `group_by` / `having` fragments. Simple column names and
  dotted struct paths route through the library's `SqlIdentifier` +
  `createStructAccess` (each part quoted); anything else is embedded as a raw
  SQL fragment. Used by the data-table renderer.

**The placeholder contract** (enforced by `validate.ts`): a `{{where}}` requires
a `filter_by`, and a `filter_by` requires a `{{where}}` — a placeholder with no
matching Selection is meaningless and rejected, and a missing one is required.
The same rule pairs `{{having}}` with `having_by`. This is why `kpi_phrases_all`
(the opt-out card) has **no** `{{where}}` in its statement.

## The renderer registry

Four generic, domain-blind renderers (`src/widgets/registry.tsx`), each keyed by
`renderer:` and narrowing on the discriminated `WidgetSpec` union:

- **`kpi-card`** — one `useMosaicValues` client reading a `value` column,
  formatted through the formatter registry. Omitting `filter_by` passes **no**
  `filterBy` to the client, so the value stays constant under any filter.
- **`selection-table`** — a grouped `key`/`metric` table (`useMosaicRows`) with
  row-select publishing (a `select:<id>` points spec every sibling reads),
  optional sparkline column (`useMosaicSparkline`) and an optional
  metric-threshold control that lives in the (right-aligned) metric column
  header: a funnel trigger opening a native Popover-API panel (operator +
  value + explicit **Apply**/**Clear**) that publishes/removes the
  `metric:<id>` spec only on Apply — no publish-per-keystroke. Optional
  enlarge/return promotion.
- **`data-table`** — a user-owned TanStack Table v9 (manual mode) whose column
  filters bridge into the page filter set via `bridge_columns`, so filtering the
  table filters every sibling too.
- **`vgplot`** — compiles the spec's plot DSL into a live vgplot plot (see
  below). **Geometry is the renderer's concern:** a `ResizeObserver` measures the
  card and the renderer injects width/height/margins/tick-counts, mutating the
  built plot's attributes in place (never rebuilding) so a live brush overlay
  survives a resize or expand/collapse. **Selection chrome** (the committed-value
  strip + external-clear reset) renders **only** when the plot declares
  `selects` whose `as` refs resolve in the topology; a plot with none renders no
  chrome.

## Widget `meta` — renderer-defined vocabulary

Every widget variant accepts an optional free-form `meta` map
(`z.record(z.string(), z.unknown())`). It is **opaque to the schema**: the
interpreter never inspects it at compile time. Instead it rides along on the
widget object each renderer already receives, and a renderer picks out the keys
it understands. Following the **smart-renderer principle**, a renderer must
tolerate absent metadata and unknown keys — it never throws on `meta` contents.
The vocabulary is therefore _defined by the renderer_, not the schema: two
renderers can read entirely different `meta` keys.

The one shipped capability demonstrates the pass-through end to end: the
`data-table` renderer honors `meta: { exportable: true }` by rendering an
**Export CSV** button (`data-testid="detail-<id>-export"`) that client-side
downloads the current page's rows as CSV (a `Blob` + object URL). The headers
come from the widget's column defs and every field is RFC-4180 escaped
(quotes/commas/newlines). Any other `meta` key is ignored. The detail widget in
`questions.yaml` carries `meta: { exportable: true }`; drop it and the button
disappears with no other change.

Envisioned future uses — all renderer-defined, none needing a schema change —
include a chart-PNG export on the `vgplot` renderer
(`meta: { exportable: 'png' }`) or a per-widget pagination-size override on the
`data-table` renderer (`meta: { page_size_options: [10, 50, 100] }`). Each is a
new key one renderer chooses to interpret, not new schema surface.

## The plot DSL

The `plot:` node (`src/spec/plot-interpreter.ts`) is an app-owned DSL inspired by
mosaic-specs, carrying only **semantic** attributes — there is deliberately no
width/height/margin vocabulary. Extending it is **one vocabulary entry** (a new
mark/encoding/select case in the interpreter + its schema variant).

| Category      | Vocabulary                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **marks**     | `rectY`, `dot`, `lineY`, `areaY`, `regressionY` — each with `data: { from, filter_by? }`                                |
| **encodings** | channel value = bare column, constant number, `{ bin }`, `{ agg, column? }`, or `{ date_bin, interval }`                |
| **channels**  | `x`, `y`, `r`, `opacity`; `fill` / `stroke` (CSS color → constant, else categorical field)                              |
| **selects**   | `intervalX`, `intervalXY`, `toggle` (`as` → topology Selection; `brush` styling optional)                               |
| **attrs**     | `x_scale`/`y_scale`, `x_domain`/`y_domain`/`xy_domain: fixed`, `color_domain`, `x_label`/`y_label`, `x_ticks`/`y_ticks` |

A `toggle` select **requires** a non-empty `channels:` array (vgplot's `Toggle`
needs it) — enforced by both the schema and the interpreter. Color strings pass
straight through to Observable Plot, which resolves a valid CSS color as a
constant and anything else as a categorical field, so the interpreter never
inspects the string.

## Filter behaviors (`filter_kinds`)

A `filter_kinds:` entry names a generic `behavior` (a factory shipped in
`src/spec/kinds.ts`) and its `config`. The kind registry is the library
built-ins merged with these instantiated kinds. The one shipped behavior,
`aggregate-threshold`, generalizes a per-group aggregate compared against a
threshold: it emits a `HAVING <aggregate> >/< N` clause on `having_target` (the
widget's own grouped query) **and** a membership subquery
(`<group_by> IN (SELECT … GROUP BY … HAVING …)`) on `members_target` (narrowing
every sibling). Nothing about the table, group key, aggregate, or targets is
hardcoded — they all arrive from the spec.

## The derived table + the connector seam

`questions_enriched` (a `type: sql` derived table) is the fetch → pre-compute →
query demo: the raw `questions` parquet loads first, then a
`CREATE OR REPLACE TABLE … AS SELECT *, CASE … AS volume_bucket` pre-computes a
bucket column a facet field and a summary card group by. Every widget reads the
enriched relation.

Because the Mosaic connector is **app policy** (this example owns its
`Coordinator` + `wasmConnector` in `src/connector.tsx`), the same
pre-computation seam generalizes without touching a single widget spec: a
REST-backed connector, or REST-fetched `type: json` sources that arrive already
pre-computed, slot into the `data.tables` section behind the identical query
interface.

## Spec editor behavior

The collapsible editor (`src/chrome/spec-editor.tsx`) is intentionally
opinionated:

- **Apply** recompiles the draft. On success it hands the new compiled spec up
  to `Bootstrap`, which bumps a revision key and **remounts** the dashboard
  subtree — resetting every Selection and all in-widget selections. On failure
  it renders every error and leaves the last-good dashboard running untouched
  (no teardown).
- **Reset** restores the _originally fetched_ text into the draft and clears the
  error list, but does **not** apply it — the running dashboard is left as-is
  until you Apply again. (Reset is an editor-draft action, not a dashboard one.)

## snake_case convention

Every spec KEY is `lower_snake_case` (`filter_by`, `having_by`, `metric_label`,
`page_size`, `accessor_key`, `value_kind`, `array_column`, `facet_table`,
`spec_id`, `group_by`, `bridge_columns`, …), and author-chosen names (widget
ids, topology entries, filter-kind names) are snake_case too. The libraries'
camelCase types are reached only at the compile boundary — never in the spec.

## E2E

```sh
pnpm --filter example-react-spec-dashboard test:e2e
```

`tests/spec-dashboard.test.ts` covers: (a) a clean load — all five KPIs
populate, the vgplot bars paint, the summary and detail tables show rows, **and
no page errors or catalog/`exclusiveFacets` console noise appear** (the
construct-before-load race guard); (b) a builder phrase
filter cross-filtering the page while the opt-out `kpi_phrases_all` value stays
byte-for-byte constant, then clearing; (c) a summary row selection cross-filtering
the detail table via a `select:` chip; (d) a spec edit + Apply remount surfacing
a new label, then an invalid spec showing errors while the last-good dashboard
keeps rendering; (e) the vgplot panel expanding (its plot grows) and collapsing;
(f) the phrase metric threshold routing a `HAVING` to its own table and a
membership subquery to its siblings; (g)/(h) enlarging a summary table,
selecting rows, and returning keeps the non-selected rows (the self-exclusion
regression guard); (i) the quick-load selector rendering the manifest option,
`?spec=questions` loading identically to no param, and switching the selector
writing `?spec=<id>` and reloading; (ii) the detail table's Export CSV button
producing a download whose header row matches the column headers; (iii) the
header rendering the title only, with the removed subtitle absent. DuckDB-WASM's
first paint is slow, so the suite waits on dataset-constant KPI values with
generous timeouts rather than fixed sleeps.
