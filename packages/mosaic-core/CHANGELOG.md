# @nozzleio/mosaic-core

## 0.10.0

### Minor Changes

- [#282](https://github.com/nozzle/mosaic-adapters/pull/282) [`c71dc46`](https://github.com/nozzle/mosaic-adapters/commit/c71dc463512416c18ad9b70eda1da1959e27cf74) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `topology.destroy()` now tears down its owned `compose`/`cascading` contexts and FilterSets silently by default: relays are detached but no clear clause is published and no `value` event fires, so clients still connected to those contexts no longer each run one unfiltered query on their way out. Pass `clearOnDestroy: true` in the `createTopology` options to restore the previous clearing teardown. External instances are still never touched.

  The building blocks gain the same opt-in: `FilterSet.destroy({ silent: true })`, and `destroy({ silent: true })` on the handles returned by `createComposedSelection` and `createCascadingContexts`. Their default (clearing) teardown is unchanged. New exported types: `FilterSetDestroyOptions` and `CompositionDestroyOptions`.

  `useTopology` inherits the silent teardown, so a parent unmounting no longer makes its still-connected descendants re-query.

- [#281](https://github.com/nozzle/mosaic-adapters/pull/281) [`7ad8964`](https://github.com/nozzle/mosaic-adapters/commit/7ad89646d7f771b11c3e9d0e0e00d6581e50b32e) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Stop reporting a cancelled main query as a failure. When `coordinator.cancel()` or `coordinator.clear()` rejects a client's current request with `'Canceled'`/`'Cleared'`, the store now keeps `status: 'pending'` (and its previous `error`) until the next trigger re-queries, instead of switching to `status: 'error'`.

  Add two helpers, also re-exported from `@nozzleio/react-mosaic`:

  - `isQueryCancellation(error)` recognises a cancellation in every shape Mosaic delivers it (bare string, `Error`, or a `QueryError` whose `cause` is one), so you no longer need to string-match Mosaic internals.
  - `describeQueryError(error)` splits a failure into a display `message`, the `sql` (for a `QueryError`) and its `cause`, so a UI can show the message without the SQL that `QueryError.message` embeds. It returns `null` for no error.

- [#290](https://github.com/nozzle/mosaic-adapters/pull/290) [`4ad2f5d`](https://github.com/nozzle/mosaic-adapters/commit/4ad2f5df1674bf1709523ce46dc957519ef23714) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Issue one query when a single action writes a `filterBy` clause and Params. Clients that cannot pre-aggregate (`filterStable: false` — the default or forced value for the facet, sparkline, rollup and pivot clients — or a non-empty `skipSources`) now re-query `filterBy` changes through the same coalesced batch as Params, `havingBy`, `setInputs` and `invalidate()`, so a clause and a Param written in the same tick, in either order, build one query carrying both instead of two. A batch holding only `filterBy` changes is issued like upstream's standard selection update and leaves pre-aggregating siblings' materialized tables in place. Clients that can pre-aggregate keep upstream `Coordinator.updateSelection` unchanged.

  Affected clients' brush-driven re-queries now wait one animation frame in a visible tab, where upstream queried synchronously. Opt a client out with the new `coalesceFilterBy: false` option (on every client factory, and a structural option on the React hooks) to keep upstream's immediate path. See "One query per action" in `docs/core/concepts.md` for write-order guidance on pre-aggregating clients.

- [#285](https://github.com/nozzle/mosaic-adapters/pull/285) [`ec34218`](https://github.com/nozzle/mosaic-adapters/commit/ec34218a96fb713777979df61225a61586d00b9c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add a way to re-query a compiled query, and expose what the payload on screen answers.

  - `client.invalidate()` re-queries because the query itself changed (for example after `setQuery(...)` with a recompiled factory). It is coalesced like an inputs change, so an `invalidate()` in the same tick as a `setInputs` issues one query, and unlike `refetch()` it keeps query-derived memos such as the rows client's `rowCount: 'query'` COUNT. While the client is disabled, the re-query runs once it is enabled.
  - Every data-client hook (`useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`) takes an optional `queryKey` deps array, compared element-wise with `Object.is` like the `useVgPlot` deps. A change calls `client.invalidate()`; the first render never re-queries, and omitting it keeps the existing latest-ref behaviour. The option's type is exported as `QueryKeyOptions`.
  - The store gains `settled: { inputs, query } | null` (type `DataClientSettled`): the inputs and SQL of the request whose response (or empty round) produced the current payload. It is `null` until the first successful response or empty round and moves only when the current request succeeds, so `status === 'pending' && settled === null` is the initial load and `settled.query !== lastQuery` means the payload answers an older query. `settled.query` is `null` for an empty round and for responses answered by the coordinator's pre-aggregation path.

- [#284](https://github.com/nozzle/mosaic-adapters/pull/284) [`27fe544`](https://github.com/nozzle/mosaic-adapters/commit/27fe544138b29c4a7323eddc3f2b0410fe02ae3f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - FilterSet gains routing, partial-reset and clause-computation helpers. All additions are opt-in; existing behaviour is unchanged.

  - `createFilterSet({ defaultTarget })` picks the target a spec routes to when neither its kind's emission nor the spec names one (resolution order `emission.target ?? spec.target ?? defaultTarget`). It defaults to `'where'`; an explicit value must name one of `targets` or `createFilterSet` throws. `filterSet.defaultTarget` reads back the resolved value, and `filterSet.kinds` exposes the set's merged, frozen kind registry. Topology `filter-set` declarations accept the same `defaultTarget`, validated by `createTopology`.
  - `filterSet.reset({ keep })` removes only the specs the predicate rejects, in one store update and one persister write. Kept specs stay published and are not re-published (unless their kind reads `contextPredicate` and the SQL changes). If `keep` accepts every spec, the call is a no-op.
  - New `emitFilterSpec(spec, options)` and `filterSpecPredicate(spec, options)` compute the clauses a spec would publish without going through a set. The set's own publish path uses the same code, so the results cannot drift.
  - `publish: { into, id, kind?, label?, target? }` on the facet, histogram and rows clients now accepts `target`, written to the published spec's `target`. A remounted widget that re-adopts an existing spec keeps the stored `target`.

  New exported types: `EmitFilterSpecOptions`, `FilterSetResetOptions`, `FilterSpecEmission` and `FilterSpecPredicateOptions`.

  In `@nozzleio/react-mosaic`, `useMosaicFacet`, `useMosaicHistogram` and `useMosaicRows` recreate their client when `publish.target` changes, matching the other `publish.into` fields.

- [#286](https://github.com/nozzle/mosaic-adapters/pull/286) [`9799aaa`](https://github.com/nozzle/mosaic-adapters/commit/9799aaa3e3df1557e6256acb7fcebae76a2d5f2a) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Filter kinds gain a regex operator, array-aware text operators, composite-key subqueries and an aggregate-threshold kind. All additions are opt-in; existing specs emit the same SQL.

  - `conditionFilterKind` accepts `matches` / `not_matches` (DuckDB `regexp_matches`, RE2 syntax, case-sensitive unless the pattern uses `(?i)`). An empty value leaves the spec inactive.
  - With `columnType: 'array'`, the text operators (`contains`, `starts_with`, `ends_with`, `matches` and their `not_*` forms) now test the list's elements: the positive form keeps rows where any element matches, the `not_*` form keeps rows where no element matches. Previously they applied `ILIKE` to the list itself.
  - `subqueryFilterKind(build, { columns })` and `buildSubqueryClauseParts({ column: [...] })` accept several outer columns for a composite key, emitting `(a, b) [NOT] IN (SELECT a, b ...)`. `buildSubqueryClauseParts` now also returns `fields`, the column nodes embedded in the predicate; a subquery kind's emission lists every outer column in `fields`. Passing an empty column list throws.
  - New `aggregateThresholdFilterKind({ from, aggregate, targets: { having, members }, operators? })` keeps the groups of a spec's `column` whose aggregate passes `operator value`. It emits the bare aggregate comparison on `targets.having` (for `havingBy`) and a `column IN (SELECT column ... GROUP BY column HAVING ...)` membership clause on `targets.members`, rebuilt when the context Selection changes. `THRESHOLD_OPERATORS` lists its operator vocabulary.

  New exported types: `AggregateThresholdKindOptions`, `SubqueryClauseParts`, `SubqueryColumn`, `SubqueryFilterKindOptions` and `ThresholdOperator`.

- [#279](https://github.com/nozzle/mosaic-adapters/pull/279) [`4df81ea`](https://github.com/nozzle/mosaic-adapters/commit/4df81eaef7b43cd10b9d55671836f401d38c4a0a) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Accept a schema-qualified table as a query source, and read dotted column options in the facet, histogram, sparkline and pivot clients as struct paths.

  - `QuerySource` now also accepts a `TableRefNode` from `@uwdata/mosaic-sql`: `new TableRefNode(['main', 'events'])` renders `FROM "main"."events"`. A plain string is still one identifier (`'main.events'` renders `FROM "main.events"`) and is never split; a dotted string logs a development-only warning, once per client, suggesting `TableRefNode`. An array source throws, since mosaic-sql renders `Query.from(['main', 'events'])` as a cross join.
  - New `isSameQuerySource(a, b)` export. The React hooks use it to compare sources, so a `TableRefNode` built inline on every render is compared by its SQL form instead of identity.
  - The facet, histogram, sparkline and pivot clients resolve dotted column options as struct paths, matching the rows client and FilterSet: `meta.country` renders `"meta"."country"` instead of `"meta.country"`. The same expression is used for the published clause `fields`. The pivot client projects struct paths onto the source under their dotted names, since DuckDB rejects qualified references inside `PIVOT`. SQL for names without a dot is unchanged.
  - **Behaviour change for dotted column names:** a column whose name itself contains a dot now needs the new `columnPaths: 'literal'` option (on the four clients and their hooks) to keep the previous single-identifier SQL. `FilterSpec.columnPaths` carries the same choice to the FilterSet, and `ColumnPathMode`/`ColumnPathOptions` are exported.

- [#297](https://github.com/nozzle/mosaic-adapters/pull/297) [`974f5d7`](https://github.com/nozzle/mosaic-adapters/commit/974f5d79baed078d5afbfb0f5573f5c3bee6f8d6) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add debugging aids to data clients.

  - A `meta` option (type `DataClientMeta`) attaches consumer-owned debugging metadata (a widget id, a label) to a client. It is exposed as `client.meta`, replaced with `client.setMeta(...)`, and never read by the library or included in the query: it is held by latest-ref, so changing it never re-queries, and the React data-client hooks accept it without ever recreating the client. The client mirrors it onto `client.mosaicClient` under the registered symbol `MOSAIC_CLIENT_META`; `getClientMeta(mosaicClient)` reads it back, so coordinator-level observers can attribute each query to the widget that issued it.
  - `client.previewQuery(options?)` returns `{ main, count }` (type `QueryPreview`): the SQL the client would issue for its current filters and inputs, or for `where`/`having`/`inputs` overrides (`QueryPreviewOptions`), without issuing anything or touching the store. `count` is the rows client's `rowCount: 'query'` COUNT SQL and `null` otherwise. The SQL text is not a stable format.
  - In development (`process.env.NODE_ENV` set and not `'production'`), a client warns once when its query factory is handed an active `where` or `having` predicate and never reads it, since the resulting query silently ignores that filter. Reading the predicate (`void ctx.where`) acknowledges a deliberate omission. Production builds and environments without `NODE_ENV` never warn.

- [#287](https://github.com/nozzle/mosaic-adapters/pull/287) [`e1277e1`](https://github.com/nozzle/mosaic-adapters/commit/e1277e1ec168fb5ea0bb7059efe6ec255725b9de) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Export the query-result row helpers, the histogram binning helpers, and a general mapped Selection primitive.

  - New `toResultRows(data)`, `firstResultRow(data)` and `resultRowCount(data)` exports read coordinator query results (Arrow tables or arrays). `firstResultRow` reads an Arrow table with `.get(0)` and `resultRowCount` reads `numRows`, so neither materializes a large result.
  - New histogram helpers for building custom bin queries with the same binning as `createHistogramClient`: `histogramBinning`, `histogramExtentQuery`, `histogramSelect`, `histogramFilter` and `histogramBinsFromRows`, plus the `HistogramBase`, `HistogramBinOptions`, `HistogramBinning`, `HistogramBinningOptions`, `HistogramBinsResult`, `HistogramColumn`, `HistogramExtentQueryOptions` and `HistogramScale` types. The histogram client now uses them; its SQL is unchanged.
  - New `createMappedSelection(parent, map, options?)`: a derived Selection whose clauses are `map` applied to each of the parent's clauses (`null` drops a clause). It relays like upstream `include`, follows snapshot-style parents by content, and returns a `MappedSelectionHandle` with `selection`, `refresh()` and `destroy()`. `MappedSelectionOptions` (an optional `resolver` override, defaulting to the parent's) and `SelectionClauseMap` are exported.
  - `createSkipProjectedSelection` is now built on `createMappedSelection`. Its SQL and emissions are unchanged.
  - **Behaviour note:** with a `Selection.single()` parent, a skip-projected or mapped Selection no longer calls `source.reset()` a second time on a clause the parent displaced. Upstream `include` relays do make that second call; the parent still resets the displaced source once.

- [#288](https://github.com/nozzle/mosaic-adapters/pull/288) [`95ba3e1`](https://github.com/nozzle/mosaic-adapters/commit/95ba3e1ae10725051e5a34fe681ed46217d04529) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Expose the rows client's row selection as state, and let the TanStack Table filter bridge be conditional or keep its filters applied after teardown.

  - `RowsClientState` gains `selected`: the currently published row-selection tuples (aligned to `publish.select.columns`), `[]` when nothing is selected. It follows every change, including `selectRows`, `setSelectedValues`, persisted/FilterSet hydration, external clears and the destroy-time clear. It only notifies subscribers when the value actually changes.
  - `setSelectedValues` now accepts readonly tuples, so `state.selected` can be replayed directly. The tuples are copied, not held.
  - `FilterBridge.destroy()` accepts an optional `{ retainSpecs: true }` (new `FilterBridgeDestroyOptions` type) to leave every managed spec in the set instead of removing it. The default is unchanged: destroy removes the specs the bridge wrote.
  - `useTanStackTableFilterBridge` accepts `set: undefined`, which makes the bridge inert (no bridge, no publishing, no `onExternalChange`). Switching a set to `undefined` tears the bridge down like an unmount. The new `retainSpecsOnUnmount` option (default `false`) keeps the managed specs in the set on teardown.

- [#301](https://github.com/nozzle/mosaic-adapters/pull/301) [`9c5a5ee`](https://github.com/nozzle/mosaic-adapters/commit/9c5a5eea7fce13b4e0f125e93645deea24283e72) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add an opt-in `batch(fn)` to FilterSets and topologies, so several writes from one user action publish as one update. Nothing changes unless you call it.

  - `filterSet.batch((tx) => { ... })` defers the Selection emits of every `set` / `remove` / `clear` / `reset` made inside the callback. Resolved clauses update as each write happens; when the callback returns, every touched Selection (targets, and the `compose` / `cascading` contexts and `skipSources` projections derived from them) emits once, `store` updates once and the persister is written once. Context-dependent kinds are rebuilt inside the batch, so they ship with their siblings' final clauses.
  - `topology.batch(fn)` shares one batch across every FilterSet the topology owns, plus the Selection resets of `topology.reset()`, and refreshes `activeClauses` once.

  Documented limitations:

  - A batched emission carries a synthetic active clause (fresh source, `null` predicate), so Mosaic's pre-aggregation is skipped for that one update, `selection.active` is the synthetic clause, and on a crossfilter target the publishing widget re-queries too.
  - Only one batch can be open at a time. A nested `batch()` joins the open batch only when that batch already covers it (the same FilterSet, a FilterSet owned by the open topology batch, or the same topology); any other nesting, including `topology.batch()` inside an owned set's `filterSet.batch()`, an uncovered `batch()` from a filter kind while the batch settles, or any `batch()` from a `value` listener while it flushes, throws `NESTED_BATCH_ERROR_MESSAGE` (now exported).
  - Params, direct `selection.update(...)` calls and Selections whose `update` / `reset` are overridden (including `createMappedSelection` results other than the `skipSources` projection) are not deferred; they emit immediately as usual.
  - Not a transaction: if the callback throws, earlier writes still apply and emit, then the callback's error propagates. The callback must be synchronous. A cyclic FilterSet context graph is not guaranteed to settle inside the batch.

  New exported types: `FilterSetBatchWriter`. The `FilterSet` and `Topology` interfaces gain a required `batch` member, so an object that implements either by hand (a test double, say) needs one too.

- [#289](https://github.com/nozzle/mosaic-adapters/pull/289) [`5f066c8`](https://github.com/nozzle/mosaic-adapters/commit/5f066c8eddc855d1ffec27cd427f8e58237545f1) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add temporary, typed helpers for gaps in `@uwdata/mosaic-sql` 0.32, so callers no longer write to private query fields or cast types. Each helper is removed or aliased once mosaic-sql ships the equivalent, and tests pin the SQL each one renders.

  - New `withRecursive(query, name, body, options?)`: adds a CTE and renders the WITH clause as `WITH RECURSIVE`. Each CTE keeps its `name` and `query`, so Mosaic's pre-aggregation lineage still sees it as a CTE rather than a base table. `WithRecursiveOptions` (`materialized`, `columnNames`) is exported.
  - New `selectStarExclude(query, columns)`: appends `* EXCLUDE ("a", "b")` to the SELECT list. An empty list appends a plain `*`.
  - New `sqlFromParts(strings, ...values)`: the `sql` template tag, callable with parts built at runtime and without a `TemplateStringsArray` cast. `SqlTemplateValue` is exported.
  - New `tableRef(...names)`: builds a `TableRefNode` (`tableRef('main', 'events')` renders `"main"."events"`) and throws on an empty list or name.
  - New `andOrTrue(...clauses)`: mosaic-sql's `and()`, except an empty conjunction renders `TRUE` instead of an empty string.

### Patch Changes

- [#277](https://github.com/nozzle/mosaic-adapters/pull/277) [`e1c1f3d`](https://github.com/nozzle/mosaic-adapters/commit/e1c1f3df9537098d92b0901e016d8423d6b898cb) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Fix topology context seeding when several clauses land on a source Selection in the same tick. `compose` and `cascading` contexts now seed from each source's resolved clause list instead of `.clauses`, which only reflects the last emitted list and could miss clauses (for example when a FilterSet hydrates multiple specs at once). Null-predicate clauses are skipped when seeding.

  `topology.reset()` now clears `standalone` and `external` entries with upstream `selection.reset()`: all clauses are removed in a single update, the removal relays to derived contexts, and each clause source's `reset()` is invoked, so interactors such as vgplot interval brushes clear their own value and overlay too.

- [#275](https://github.com/nozzle/mosaic-adapters/pull/275) [`a357023`](https://github.com/nozzle/mosaic-adapters/commit/a3570237be6e5c00b49beedfae40226217650f8f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Freeze each main query at the Param values it was built with. A query that interpolates a live Param (``sql`… ${param}` ``, `column(param)`) used to re-render with the Param's newest value whenever the coordinator stringified it, so a Param change while a request was queued or in flight could send, cache or report (`QueryError.sql`) that request under SQL it was not built from, and an older request's failure could count as the current one. The client now hands the coordinator a copy pinned to the build-time SQL (also under query consolidation); your own query object is not modified and keeps rendering live.

- [#283](https://github.com/nozzle/mosaic-adapters/pull/283) [`3c35f1e`](https://github.com/nozzle/mosaic-adapters/commit/3c35f1e9dcc67aeb5eab41ddb93d9c49d4bc1756) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Complete coalesced re-queries in hidden browser tabs. Input-driven triggers (`setInputs`, Param and `havingBy` `'value'` events) ride Mosaic's animation-frame throttle, but browsers pause animation frames while a tab is hidden, so a re-query triggered in a background tab stayed `status: 'pending'` until the tab was shown again. While `document.visibilityState === 'hidden'` the client now coalesces on the same macrotask fallback it already uses outside browsers (one query per tick, last state wins). Visible tabs keep Mosaic's animation-frame throttle unchanged.

- [#274](https://github.com/nozzle/mosaic-adapters/pull/274) [`4810a46`](https://github.com/nozzle/mosaic-adapters/commit/4810a46e410c6885b63d53395a1c3990e642b115) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Facet client `search` now matches `%`, `_` and `\` literally, like upstream's `clauseMatch` 'contains' mode. The search text is escaped and the `ILIKE` uses `ESCAPE '\'`, so searching `0%` no longer matches `1000`. The `clampPagination` JSDoc now shows applying it to the pagination state in an effect after the total settles, not during render.

- [#280](https://github.com/nozzle/mosaic-adapters/pull/280) [`6608afc`](https://github.com/nozzle/mosaic-adapters/commit/6608afc216a75604ab15cfd341a860f395e9ca87) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Make the rows client's defaulted-`filterStable` warning match when Mosaic's pre-aggregation can actually apply. It now fires only when a `filterBy` Selection is set, `filterStable` was left defaulted (and not forced off by `skipSources`), and the query Mosaic sees has an outer aggregate. Besides `GROUP BY`, it now recognises `SELECT DISTINCT`, `QUALIFY`, window functions and `PIVOT`, including inside `Query.with()` CTEs, FROM subqueries and set operation members. The check runs on the final query (so the `rowCount: 'window'` wrapper no longer warns) and is retried on each build until it fires once. The message explains what `filterStable: true` promises. Defaults and query behaviour are unchanged; any explicit `filterStable` still silences the warning. The `filterStable` docs and option JSDoc are clarified to match.

- [#301](https://github.com/nozzle/mosaic-adapters/pull/301) [`9c5a5ee`](https://github.com/nozzle/mosaic-adapters/commit/9c5a5eea7fce13b4e0f125e93645deea24283e72) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Fix `createMappedSelection` (and `skipSources` projections) on a `single` parent: a clause the map drops, or a removal for a source the derived Selection does not carry, still displaces the parent's other clauses, and the derived Selection now relays that to the Selections that `include` it. Before, the derived Selection itself followed the parent once it emitted, but a Selection including it kept the displaced clause. `filterSet.batch()` / `topology.batch()` apply the same rule inside a batch.

- [#302](https://github.com/nozzle/mosaic-adapters/pull/302) [`15f1cd3`](https://github.com/nozzle/mosaic-adapters/commit/15f1cd3e0a3f632c66cce24e903882f32d950586) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Gate every development-only warning on one check. The dotted table-name hint used its own helper that treated an unset `NODE_ENV` (a plain Node script, or an unbundled browser with no `process` global) as development, so it could fire where the ignored-filter warning stayed silent. Both warnings now share the same rule: they fire only when `process.env.NODE_ENV` is set and is not `'production'`. Run a plain Node script with `NODE_ENV=development` to see them. The docs gain a "When development warnings fire" section describing each environment.

- [#304](https://github.com/nozzle/mosaic-adapters/pull/304) [`5067e8a`](https://github.com/nozzle/mosaic-adapters/commit/5067e8af5a9b82698a90bfd6a2938fd2370e1138) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Fix a FilterSet with two or more context-dependent specs (kinds that read `contextPredicate`, such as two `aggregateThresholdFilterKind` thresholds) whose clauses feed the set's own context: it now settles instead of rebuilding forever, each spec embedding the other's latest subquery one level deeper.

  While a spec's own clauses feed the context, its `contextPredicate` now also leaves out the clauses of the set's other context-dependent specs. Each threshold's inner `GROUP BY … HAVING` is evaluated without the sibling thresholds; the context itself still applies all of them, so a row must still pass every threshold. Nothing changes for a set with zero or one context-dependent spec, or for a context-dependent spec whose clauses do not reach the context.

  As a safeguard for context cycles across FilterSets, a set follows a chain of context rebuilds back to itself at most a fixed number of times, then stops and warns once in development. Acyclic chains of sets are never cut off.

## 0.9.1

### Patch Changes

- [#250](https://github.com/nozzle/mosaic-adapters/pull/250) [`0fb10fc`](https://github.com/nozzle/mosaic-adapters/commit/0fb10fcc1f26795763b9e00fea97943ed69c66e9) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Document the `@uwdata/mosaic-core`/`@uwdata/mosaic-sql` peer range in the README, and that the two must stay on the same minor version. Link the `docs/core/` reference so it resolves from npm. No code changes.

## 0.9.0

### Minor Changes

- [#241](https://github.com/nozzle/mosaic-adapters/pull/241) [`6bdf67f`](https://github.com/nozzle/mosaic-adapters/commit/6bdf67fd6ce2de5f527802c62d60c00a40221532) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.32.0 <1`** (and `@uwdata/vgplot` `>=0.32.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.32` depends on `@uwdata/mosaic-sql@^0.32`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

  No adapter APIs change. Adapting to Mosaic 0.32:

  - Clearing a multi-select facet (`select: 'multi'`) or a rows client's row selection/hover (`selectRows([])`, `setSelectedValues([])`, `hoverRow(null)`, destroy-time cleanup) still **removes** the published clause. Mosaic 0.32's `clausePoints` turns an empty value list into an active `FALSE` predicate (uwdata/mosaic#1256), which would otherwise have filtered every consumer down to zero rows; these paths now publish a clear clause instead.
  - Mosaic 0.32 drops JSON query transport and moves Arrow IPC decoding from connectors into the coordinator's `QueryManager` (set IPC extraction options with `new Coordinator(connector, { ipc })`). Custom `Connector` implementations must return raw Arrow IPC bytes for `arrow` queries; the built-in `wasmConnector`/`socketConnector`/`restConnector` already do.
  - The `QueryManager` now shares one in-flight connector request between concurrent requests for identical SQL (uwdata/mosaic#1171), so a `refetch()` that rebuilds the same SQL as a pending query joins it rather than issuing a second round trip. The current-request guarantee is unaffected: the store settles once, on the current request.
  - Date literals in generated SQL are now zero-padded (`DATE '2024-01-01'`).

  The adapters' own current-request guarantee and the `skipSources` projection in front of the coordinator remain in place: upstream `Coordinator.updateClient` still delivers completions without request identity, and `updateSelection` still re-queries on every `'value'` event without comparing predicates.

### Patch Changes

- [#247](https://github.com/nozzle/mosaic-adapters/pull/247) [`71e7827`](https://github.com/nozzle/mosaic-adapters/commit/71e7827dcd633368dd600858f5e5cdaace811e6f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Reformat the source with oxfmt. There are no runtime or API changes. The published `package.json` lists its fields in a new order.

- [#247](https://github.com/nozzle/mosaic-adapters/pull/247) [`5a75b38`](https://github.com/nozzle/mosaic-adapters/commit/5a75b38fd4c82231e6a3e168ac0827a2b3d35542) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rename the source's ESLint disable comment to an oxlint directive. There are no runtime or API changes.

- [#244](https://github.com/nozzle/mosaic-adapters/pull/244) [`21f2afd`](https://github.com/nozzle/mosaic-adapters/commit/21f2afd3e5893746032bf224e491edaea26502b9) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Refactor source for the move from ESLint to type-aware oxlint and TypeScript 7. There are no runtime or API changes, and the published type declarations are unchanged.

  - `@nozzleio/mosaic-core`: the fire-and-forget query promises in the base client's coalesced flush and in `RowsClient.prefetch` are now explicitly discarded with `void`. A redundant `void` on the `skipSources` projection's `'value'` emit is removed.
  - Both packages: lint annotations, plus formatting from Prettier 3.9.

- [#245](https://github.com/nozzle/mosaic-adapters/pull/245) [`ee4eae3`](https://github.com/nozzle/mosaic-adapters/commit/ee4eae3e790105c53791a3430374be1b7bf4297b) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Build the published packages with tsdown instead of Vite library mode, with type declarations emitted by TypeScript 7. There are no runtime or API changes. The `dist/esm` layout, entry points, and `exports` map are unchanged.

  - Declaration files that no public type refers to are no longer emitted (`base-client.d.ts` and `topology/wiring.d.ts` in `@nozzleio/mosaic-core`, `use-data-client.d.ts` in `@nozzleio/react-mosaic`).
  - The emitted JavaScript and declarations are formatted differently (for example `const` instead of `var` for module-level bindings).

## 0.8.2

### Patch Changes

- [#237](https://github.com/nozzle/mosaic-adapters/pull/237) [`0a64cd3`](https://github.com/nozzle/mosaic-adapters/commit/0a64cd3835feb784ef27cdfb6d84d5295b05841c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - The `skipSources` projection now also follows a parent Selection that publishes snapshots without `update()` — one that installs a complete clause list and emits `'value'` itself, as upstream `clone()`/`remove()` and application-side source projections do. Previously such a parent never reached the relay, so a skipping client stopped re-querying on kept clause changes after 0.8.1. The projection re-derives the effective list from the emitted value and emits once only when it differs in content (source, predicate SQL, `clients`), so a parent minting fresh clause objects per snapshot still issues no redundant query.

## 0.8.1

### Patch Changes

- [#232](https://github.com/nozzle/mosaic-adapters/pull/232) [`587ab10`](https://github.com/nozzle/mosaic-adapters/commit/587ab10157ac742a44d43451f77fa3ae5bad7c2f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Data clients now honour a current-request guarantee: only the response to the most recent main-query request writes `status`/data to the store. A response for a request that has since been superseded — by a `filterBy`/`havingBy`/Param-driven re-query, `setInputs`, `refetch()`, or an empty round — is dropped whether it succeeds or fails and whichever order responses arrive in. Previously an older in-flight query completing first would briefly report `'success'` with stale rows against the newer `inputs` (nozzle/mosaic-adapters#230).

- [#234](https://github.com/nozzle/mosaic-adapters/pull/234) [`b0443b5`](https://github.com/nozzle/mosaic-adapters/commit/b0443b5fdd6fb236a812f5ce3a831386f622abd6) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `skipSources` now applies in front of the coordinator. A data client with a non-empty `skipSources` subscribes to a derived Selection (`createSkipProjectedSelection`, newly exported) that never carries a skipped clause, so a change to a skipped source no longer issues a byte-identical query or flips `status` to `'pending'`. Kept clauses, `setInputs`, Params, `havingBy` and `refetch()` refresh exactly as before; resolver semantics (union / intersect / `empty` / crossfilter self-exclusion) are unchanged (nozzle/mosaic-adapters#229).

## 0.8.0

### Minor Changes

- [#222](https://github.com/nozzle/mosaic-adapters/pull/222) [`b92222b`](https://github.com/nozzle/mosaic-adapters/commit/b92222b6161ccd53097e2b6cb01096eed275bc9f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.31.0 <1`** (and `@uwdata/vgplot` `>=0.31.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.31` depends on `@uwdata/mosaic-sql@^0.31`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

  No adapter APIs change. Mosaic 0.31 is adopted for its upstream hardening, which the adapters inherit as-is:

  - Pre-aggregated materialized-view **creation** failures are now caught, logged through the coordinator's logger, and degrade to the standard query path (uwdata/mosaic#1158) — previously only a failing pre-aggregated **update** fell back. A wrong-but-valid pre-aggregated query still returns incorrect rows silently, so the `filterStable: false` guidance for grouped clients is unchanged.
  - Window-expression detection in `@uwdata/mosaic-sql` is now whitespace/case tolerant (uwdata/mosaic#1145), and additional DuckDB aggregate names (`countif`, `list`, `sem`, `geometric_mean`, `arg_max_null`, …) are recognized (uwdata/mosaic#1143), so verbatim aggregate/window expressions in query factories are classified correctly in more cases.

## 0.7.0

### Minor Changes

- [#217](https://github.com/nozzle/mosaic-adapters/pull/217) [`b96e9af`](https://github.com/nozzle/mosaic-adapters/commit/b96e9afbdc3c801ad1f4bb50192351bb1b21c9f1) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.30.0 <1`.** Upgrade both Mosaic packages to 0.30 or newer when installing any of the four adapter packages. The two floors move together because `@uwdata/mosaic-core@0.30` itself depends on `@uwdata/mosaic-sql@^0.30`: pairing it with an older SQL release would leave two copies of the SQL AST in the tree, and Mosaic's pre-aggregator matches clause `fields` to predicate nodes by class identity.

  Main data-client query failures now retain Mosaic 0.30's `QueryError` in `store.state.error`. The public state type stays `Error | null`, while consumers can narrow with `instanceof QueryError` from `@uwdata/mosaic-core` to inspect the coordinator-issued SQL via `.sql` and the underlying failure via `.cause`. Schema field-info failures remain plain errors because that path queries the coordinator directly.

  Separate rows-count failures (`rowCount: 'query'`) are reported through the coordinator's logger and retried on a later build, leaving the successful main query's `status`/`error` untouched — a failed side-channel count must not wedge rows that loaded fine.

  Mosaic 0.30 also retries the standard (non pre-aggregated) query when a pre-aggregated selection update returns a `QueryError`, so a client that wrongly claims `filterStable` and produces a failing optimizer path degrades to a correct, slower query instead of getting stuck. A wrong-but-valid pre-aggregated query still returns incorrect rows with no error, so the `filterStable: false` guidance for grouped clients is unchanged.

## 0.6.0

### Minor Changes

- [#212](https://github.com/nozzle/mosaic-adapters/pull/212) [`1a5d3ab`](https://github.com/nozzle/mosaic-adapters/commit/1a5d3ab714c19bbebacc68c8c8f81ef0b1e792ed) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `createTopology` now models Mosaic `Param` nodes as first-class topology entries. A `param` declaration owns a `Param.value(default)`, while an `external-param` declaration binds a caller-supplied instance passed via `options.params` (with the same strict symmetry checks as `external` selections). Params resolve through the new `resolveParam(ref)` accessor and are exposed eagerly on the `params` record; they are validated as leaves and rejected in compose `include`, cascading `keys`/`externals`, and filter-set `context` refs. `reset()` restores owned params to their `default` (honoring `reset: false`), skips external params, and params are never enumerated as active clauses. `resolveParam` is generic — `resolveParam<TParamValue = any>(ref)` — so a caller can assert the value type at the call site (`resolveParam<MedalMetric>('metric')`) instead of casting the result.

- [#212](https://github.com/nozzle/mosaic-adapters/pull/212) [`1a5d3ab`](https://github.com/nozzle/mosaic-adapters/commit/1a5d3ab714c19bbebacc68c8c8f81ef0b1e792ed) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add per-entry `paramOptions.persist` to `createTopology`, giving topology-owned `param` entries Persister-backed live values. A non-nullish persisted value hydrates the param at construction and wins over the declared `default`; every subsequent value change (including `reset()`'s restore-to-default) writes through the same lifecycle used by filter-set persistence, with hydration echo suppression. Persistence applies to owned `param` entries only — supplying it for any other entry, including an `external-param`, is a construction error.

## 0.5.0

### Minor Changes

- [#210](https://github.com/nozzle/mosaic-adapters/pull/210) [`2abc8ae`](https://github.com/nozzle/mosaic-adapters/commit/2abc8ae20c58fbe11e94b5dfbaa1c3fbcd809e07) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.29.0`. Mosaic 0.29 adds a required `fields` property to the `SelectionClause` interface — the input field expressions a clause filters over — which the PreAggregator matches to predicate nodes by object identity. Every Selection clause this package constructs (value, subquery, clear, facet, and FilterSet emissions) now populates `fields`, sharing the exact column node instances referenced in each predicate so pre-aggregation keeps working. Clear clauses use the canonical empty form (`clauseNone`/`fields: []`). This is a breaking change for the peer-dependency range; consumers must upgrade their Mosaic packages to `>=0.29.0`.

  `@nozzleio/mosaic-core` also gains a new export, `buildSubqueryClauseParts`, which returns both the `column [NOT] IN (SELECT ...)` predicate and the outer column node so consumers can populate a clause's `fields` with the identical node instance.

## 0.4.0

### Minor Changes

- [#207](https://github.com/nozzle/mosaic-adapters/pull/207) [`72d551d`](https://github.com/nozzle/mosaic-adapters/commit/72d551dce5b0c47f5f7625595521918a69c70581) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Data clients now accept `skipSources?: ReadonlySet<string>` on `DataClientOptions`, a read-side clause filter that ignores named clause sources when resolving `filterBy` (WHERE) and `havingBy` (HAVING), matched against each clause's `source.id`. This lets a consumer opt out of specific filters in a shared `Selection` — Grafana-style per-widget filter scoping — while still honoring the rest.

  Resolution delegates to the Selection's own resolver, so union/intersect/`empty`/crossfilter semantics (including this client's own crossfilter self-exclusion) are preserved exactly; a multi-target `FilterSet` spec keys every clause to its spec id, so skipping an id drops all of that spec's clauses. Sources without a string `id` are never skipped. Absent or empty → behavior is identical to before. A non-empty set forces `filterStable: false` so pre-aggregation (which re-applies the active clause outside the client's query callback) cannot leak a skipped clause back in.

## 0.3.1

### Patch Changes

- [#203](https://github.com/nozzle/mosaic-adapters/pull/203) [`870c794`](https://github.com/nozzle/mosaic-adapters/commit/870c794ad58c1a62f8472dced2ee265c26c27525) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Coalesce input-driven re-queries. `setInputs`, Param `'value'`, and `havingBy` `'value'` no longer issue an immediate `requestQuery()` per event: a burst of synchronous changes in one tick — page-spam, a dragged slider Param — collapses into a single query build with the last state winning. In browsers this rides upstream `MosaicClient.requestUpdate()` (animation-frame throttle); in environments without `requestAnimationFrame` the client uses a built-in macrotask fallback with the same one-build-per-tick semantics. `status` still flips to `'pending'` synchronously so loading indicators stay responsive, and `refetch()` remains immediate and un-coalesced (it also cancels a pending fallback flush). No API surface change; only re-query timing.

- [#203](https://github.com/nozzle/mosaic-adapters/pull/203) [`74ef2a7`](https://github.com/nozzle/mosaic-adapters/commit/74ef2a73d3349430a224c30cee9d06586301542f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rollup client: the pre-order `ORDER BY` now reads each groupBy column's
  subtotal flag as a bit off the already-selected `GROUPING()` mask instead of
  issuing a redundant `GROUPING()` call per column. Emitted SQL and row
  ordering are unchanged.

- [#203](https://github.com/nozzle/mosaic-adapters/pull/203) [`07aae12`](https://github.com/nozzle/mosaic-adapters/commit/07aae12f262b044e6d30ddc04f7e9ba7a7093f3c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Sparkline clients without a `filterBy` selection no longer issue a trivial `WHERE FALSE` query when `inputs.keys` is empty — they publish the empty series state directly and skip the database round trip entirely, with `store.state.lastQuery` as `null` for the skipped case. Cross-filtered sparklines keep the trivial `WHERE FALSE` query for empty keys, since upstream selection updates always expect a real query.

- [#203](https://github.com/nozzle/mosaic-adapters/pull/203) [`b7d6a27`](https://github.com/nozzle/mosaic-adapters/commit/b7d6a273092525fb83d2a9fde5b1a96062c4d66c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rows clients with `rowCount: 'query'` now memoize the standing count query and re-issue it only when the WHERE/HAVING/base predicate changes (and on an explicit `refetch()`). Page turns and sort changes strip `orderBy`/`limit`/`offset` from the count SQL, so they no longer enqueue a redundant count request/promise round trip; `totalRows` holds its previous value. `refetch()` forces a fresh count in case the underlying data changed with an unchanged predicate.

- [#203](https://github.com/nozzle/mosaic-adapters/pull/203) [`c6cc739`](https://github.com/nozzle/mosaic-adapters/commit/c6cc7397c36f8e4e360d1ec5bdbe60f515b812c2) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rows client `rowCount: 'window'` now wraps the base query in a subquery
  (`SELECT *, count(*) OVER () FROM (<base>)`) instead of appending the window
  expression alongside the base's own columns. Appending in-scope silently
  miscounted a `DISTINCT` base — the window saw pre-dedup rows — and could not
  attach to a set-operation base at all. Ordering, limit, and offset now apply to
  the outer wrapper, matching the shape the `'query'` count path already produces.

## 0.3.0

### Minor Changes

- [#202](https://github.com/nozzle/mosaic-adapters/pull/202) [`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Histogram clients now accept `scale: 'linear' | 'log'`. Log-scaled histograms
  discover a positive extent and produce multiplicative bin boundaries, allowing
  custom renderers to align queried counts with a logarithmic visual axis.

## 0.2.1

### Patch Changes

- [#196](https://github.com/nozzle/mosaic-adapters/pull/196) [`33367fb`](https://github.com/nozzle/mosaic-adapters/commit/33367fba7ed50e915612e67570d83d19bf386207) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Fix crossfilter self-exclusion loss when a FilterSet-publishing client remounts. A client destroyed inside the deferred prepare/adopt window no longer re-keys the surviving clause to itself (guarded in the base client's `prepare` wrapper and in the rows/facet/histogram `#adoptFromSet` paths), and a freshly-adopted client now re-queries once its own clause is confirmed self-excluded on its filter context, so a remounted selection table no longer renders only its selected rows. Reproducible in production builds under fast unmount/remount, not just React StrictMode.

## 0.2.0

### Minor Changes

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — complete rewrite.** `@nozzleio/mosaic-core` is now the framework-agnostic data-client core, and the entire legacy API is gone. Consumers upgrading from a prior version must migrate wholesale; nothing from the old surface is re-exported. The new core is built around a base `DataClient` over upstream `makeClient` that routes `filterBy` predicates to WHERE and `havingBy` predicates to HAVING, auto-requeries on Param changes, builds queries from a latest-ref factory, diffs serializable inputs before requerying, and exposes a `@tanstack/store` state of `{ status, error, inputs, lastQuery }`.

  - Purpose-built clients: `createRowsClient` (orderBy/limit/offset, window vs. query row counts, select/hover clause publishing with remount-stable `source` and struct-path `fields`, prefetch), `createValuesClient`, `createFacetClient` (array columns, multi-select), `createHistogramClient` (fixed-extent bins), `createSparklineClient` (batched per-key, date bins), `createRollupClient` + `rollupRowsToTree` (GROUP BY ROLLUP), `createPivotClient` (DuckDB PIVOT, dynamic columns), and `createSchemaClient`.
  - Filter-builder core (`filter-builder/*`), the filter registry (`createFilterRegistry`), and clause/subquery utilities: `updateClauseIfChanged`, `createSubqueryClause`, `createValueClause`, `createClearClause`, `buildSubqueryPredicate`, plus `deepEqual`.
  - Native filter routing helpers `routeFilter` / `applyRoutedFilters`.

  See `docs/core/*` for the full API.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds `createFilterSet`, a page-level object that owns a set of serializable dashboard-filter intents (`FilterSpec`) and resolves each into per-target Selection clauses. Purely additive — no breaking changes.

  - Builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`) resolve a spec into zero or more clause emissions; `conditionFilterKind(options)` and `subqueryFilterKind(build)` are factories for condition-style and `IN (SELECT ...)`-shaped kinds, and the registry is consumer-extensible via `FilterSetOptions.kinds`.
  - Named target Selections (`FilterSetOptions.targets`) with WHERE/HAVING routing per emission, derived chips for an active-filter bar, and external-clear mirroring (chip bar / `selection.reset()` removes the owning spec).
  - Subquery context rebuilds: an optional `context` Selection feeds `contextPredicate` into context-dependent kinds and triggers a microtask-debounced re-publish on change.
  - Whole-set persistence via a single `Persister<FilterSpec[]>` entry (`FilterSetOptions.persist`); hydration replays each spec resiliently and never writes back.
  - New `publish: { into, id }` form on the facet, histogram, and rows clients — an alternative to `publish: { as }` that routes a widget's interaction into a `FilterSet` instead of a raw Selection, preserving widget mirror and self-exclusion semantics.

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — filter-builder and filter-registry deleted.** Both subsystems are subsumed by `FilterSet` and the builder-registry kinds; chips now read the set directly.

  - Removed: the entire `filter-builder/*` surface (`FilterDefinition`, value-kind and operator registries, `FilterBindingController`, condition-predicate helpers) and `filter-registry.ts` (`createFilterRegistry` and its chip types).
  - Migrate declarative filter definitions and bindings to `createFilterSet` + builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`); migrate chip consumption to the set's derived chips.
  - `sql-access` and `subquery-predicate` exports are unaffected (relocated in e5b3941, unchanged here).

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds a generic persistence contract for filter _intent_ (never resolved SQL clauses): `Persister<TState>`, with `PersisterWriteReason` (`'update' | 'clear' | 'external'`) and `PersisterWriteContext`.

  - New `persist` option on the facet, histogram, and rows clients. A synchronous `read` hydrates before the first query (no flash, no extra query); a thenable `read` hydrates on resolve and accepts a re-query. Writes are per-entry; hydration itself is never written back, and destroy-time clause cleanup never persists.
  - External clause removals (chip bar, `selection.reset()`) now write with reason `'external'`.
  - New replay setters: `facet.setSelected(values)` and `rows.setSelectedValues(tuples)`, for restoring stored intent where the original row objects no longer exist.
  - The rows client now mirrors external clears of its select clause into its internal tuple tracking — previously untracked.

  See `docs/core/concepts.md#persistence`.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- [#179](https://github.com/nozzle/mosaic-adapters/pull/179) [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix(core): the `'date'` coerce descriptor now scales microsecond-epoch bigints to milliseconds. Parquet/DuckDB `TIMESTAMP` columns surface as µs bigints; without the magnitude check they decoded to a far-future date (~year 57000). A bigint past ~year 2286 in ms is now treated as µs and divided by 1000 before constructing the `Date`.
