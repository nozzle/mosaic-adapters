# @nozzleio/react-mosaic

## 0.12.0

### Minor Changes

- [#278](https://github.com/nozzle/mosaic-adapters/pull/278) [`0889465`](https://github.com/nozzle/mosaic-adapters/commit/0889465cf56273135f6026bc71839c73603059f3) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `useVgPlot` now hands its factory a typed vgplot API context bound to the hook's resolved coordinator, so plots query the same coordinator as the data hooks.

  - The factory receives `api` — upstream `createAPIContext({ coordinator })`, typed as the exported `VgPlotApi` (with `VgPlotApiContext` / `VgPlotNamedPlots`). Build marks, interactors, and inputs through it: `useVgPlot((api) => api.plot(...))`. Existing zero-argument factories using the bare `vg.*` namespace keep working unchanged.
  - The coordinator resolves from a new optional third argument, `{ coordinator }`, then the nearest `MosaicProvider`, then the upstream global coordinator. A change of resolved coordinator rebuilds the plot.
  - One API context is shared per coordinator, so cross-plot naming (`api.name`, legends' `for`) works across plots. For the global coordinator it reuses vgplot's global `namedPlots` registry, so context-built and bare-namespace plots still see each other's names.
  - In development, the hook warns once if the built plot's marks are connected to a different coordinator than the resolved one (typically a bare `vg.plot(...)` under a `MosaicProvider`). Pass the `coordinator` option to opt a deliberately bound plot out of the check.

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

- [#273](https://github.com/nozzle/mosaic-adapters/pull/273) [`c9ffc2e`](https://github.com/nozzle/mosaic-adapters/commit/c9ffc2e8e32fa81d5b81d03d975310f188f64506) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add explicit provider boundaries for subtrees that are not ready yet.

  - `MosaicProvider` accepts `coordinator={null}`. Hooks that resolve their coordinator below it throw a clear `[react-mosaic]` error instead of silently falling back to a parent provider's coordinator or the upstream global one. An explicit `coordinator` hook option still wins, and a nested provider holding a coordinator re-opens resolution. With no provider at all, the upstream global coordinator remains the fallback, unchanged.
  - `MosaicTopologyProvider` accepts `topology={null}`, which shadows any outer provider so topology hooks below it throw the usual "no provider" error.
  - `useFilterSetState`, `useFilterSetChips`, and `useTopologyActiveClauses` accept `null` / `undefined` and return a stable, frozen empty state without subscribing.

- [#279](https://github.com/nozzle/mosaic-adapters/pull/279) [`4df81ea`](https://github.com/nozzle/mosaic-adapters/commit/4df81eaef7b43cd10b9d55671836f401d38c4a0a) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Accept a schema-qualified table as a query source, and read dotted column options in the facet, histogram, sparkline and pivot clients as struct paths.

  - `QuerySource` now also accepts a `TableRefNode` from `@uwdata/mosaic-sql`: `new TableRefNode(['main', 'events'])` renders `FROM "main"."events"`. A plain string is still one identifier (`'main.events'` renders `FROM "main.events"`) and is never split; a dotted string logs a development-only warning, once per client, suggesting `TableRefNode`. An array source throws, since mosaic-sql renders `Query.from(['main', 'events'])` as a cross join.
  - New `isSameQuerySource(a, b)` export. The React hooks use it to compare sources, so a `TableRefNode` built inline on every render is compared by its SQL form instead of identity.
  - The facet, histogram, sparkline and pivot clients resolve dotted column options as struct paths, matching the rows client and FilterSet: `meta.country` renders `"meta"."country"` instead of `"meta.country"`. The same expression is used for the published clause `fields`. The pivot client projects struct paths onto the source under their dotted names, since DuckDB rejects qualified references inside `PIVOT`. SQL for names without a dot is unchanged.
  - **Behaviour change for dotted column names:** a column whose name itself contains a dot now needs the new `columnPaths: 'literal'` option (on the four clients and their hooks) to keep the previous single-identifier SQL. `FilterSpec.columnPaths` carries the same choice to the FilterSet, and `ColumnPathMode`/`ColumnPathOptions` are exported.

- [#276](https://github.com/nozzle/mosaic-adapters/pull/276) [`bc3300f`](https://github.com/nozzle/mosaic-adapters/commit/bc3300feebc43659c03c13f31ca33dfde08ab283) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add `useMosaicParamValues(params)`, the record form of `useMosaicParamValue`: read several Params in one subscription and get back `{ [key]: value | undefined }`, each entry typed from its Param (exported `ParamValueOf` / `UseMosaicParamValuesResult` types). Entries are each Param's `value` as upstream reports it, so an explicit `null` stays `null`. The snapshot is frozen and keeps its identity while every value is `Object.is`-equal. `params` must be memoized; the subscription is keyed on the record's identity.

  `useMosaicParamValue` and `useMosaicSelectionValue` now keep a stable subscription keyed on the Param / Selection instance, so they no longer unsubscribe and re-subscribe on every render. `useMosaicSelectionValue` applies a changed `source` option at read time.

- [#297](https://github.com/nozzle/mosaic-adapters/pull/297) [`974f5d7`](https://github.com/nozzle/mosaic-adapters/commit/974f5d79baed078d5afbfb0f5573f5c3bee6f8d6) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add debugging aids to data clients.

  - A `meta` option (type `DataClientMeta`) attaches consumer-owned debugging metadata (a widget id, a label) to a client. It is exposed as `client.meta`, replaced with `client.setMeta(...)`, and never read by the library or included in the query: it is held by latest-ref, so changing it never re-queries, and the React data-client hooks accept it without ever recreating the client. The client mirrors it onto `client.mosaicClient` under the registered symbol `MOSAIC_CLIENT_META`; `getClientMeta(mosaicClient)` reads it back, so coordinator-level observers can attribute each query to the widget that issued it.
  - `client.previewQuery(options?)` returns `{ main, count }` (type `QueryPreview`): the SQL the client would issue for its current filters and inputs, or for `where`/`having`/`inputs` overrides (`QueryPreviewOptions`), without issuing anything or touching the store. `count` is the rows client's `rowCount: 'query'` COUNT SQL and `null` otherwise. The SQL text is not a stable format.
  - In development (`process.env.NODE_ENV` set and not `'production'`), a client warns once when its query factory is handed an active `where` or `having` predicate and never reads it, since the resulting query silently ignores that filter. Reading the predicate (`void ctx.where`) acknowledges a deliberate omission. Production builds and environments without `NODE_ENV` never warn.

### Patch Changes

- [#282](https://github.com/nozzle/mosaic-adapters/pull/282) [`c71dc46`](https://github.com/nozzle/mosaic-adapters/commit/c71dc463512416c18ad9b70eda1da1959e27cf74) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `topology.destroy()` now tears down its owned `compose`/`cascading` contexts and FilterSets silently by default: relays are detached but no clear clause is published and no `value` event fires, so clients still connected to those contexts no longer each run one unfiltered query on their way out. Pass `clearOnDestroy: true` in the `createTopology` options to restore the previous clearing teardown. External instances are still never touched.

  The building blocks gain the same opt-in: `FilterSet.destroy({ silent: true })`, and `destroy({ silent: true })` on the handles returned by `createComposedSelection` and `createCascadingContexts`. Their default (clearing) teardown is unchanged. New exported types: `FilterSetDestroyOptions` and `CompositionDestroyOptions`.

  `useTopology` inherits the silent teardown, so a parent unmounting no longer makes its still-connected descendants re-query.

- [#284](https://github.com/nozzle/mosaic-adapters/pull/284) [`27fe544`](https://github.com/nozzle/mosaic-adapters/commit/27fe544138b29c4a7323eddc3f2b0410fe02ae3f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - FilterSet gains routing, partial-reset and clause-computation helpers. All additions are opt-in; existing behaviour is unchanged.

  - `createFilterSet({ defaultTarget })` picks the target a spec routes to when neither its kind's emission nor the spec names one (resolution order `emission.target ?? spec.target ?? defaultTarget`). It defaults to `'where'`; an explicit value must name one of `targets` or `createFilterSet` throws. `filterSet.defaultTarget` reads back the resolved value, and `filterSet.kinds` exposes the set's merged, frozen kind registry. Topology `filter-set` declarations accept the same `defaultTarget`, validated by `createTopology`.
  - `filterSet.reset({ keep })` removes only the specs the predicate rejects, in one store update and one persister write. Kept specs stay published and are not re-published (unless their kind reads `contextPredicate` and the SQL changes). If `keep` accepts every spec, the call is a no-op.
  - New `emitFilterSpec(spec, options)` and `filterSpecPredicate(spec, options)` compute the clauses a spec would publish without going through a set. The set's own publish path uses the same code, so the results cannot drift.
  - `publish: { into, id, kind?, label?, target? }` on the facet, histogram and rows clients now accepts `target`, written to the published spec's `target`. A remounted widget that re-adopts an existing spec keeps the stored `target`.

  New exported types: `EmitFilterSpecOptions`, `FilterSetResetOptions`, `FilterSpecEmission` and `FilterSpecPredicateOptions`.

  In `@nozzleio/react-mosaic`, `useMosaicFacet`, `useMosaicHistogram` and `useMosaicRows` recreate their client when `publish.target` changes, matching the other `publish.into` fields.

- Updated dependencies [[`e1c1f3d`](https://github.com/nozzle/mosaic-adapters/commit/e1c1f3df9537098d92b0901e016d8423d6b898cb), [`a357023`](https://github.com/nozzle/mosaic-adapters/commit/a3570237be6e5c00b49beedfae40226217650f8f), [`3c35f1e`](https://github.com/nozzle/mosaic-adapters/commit/3c35f1e9dcc67aeb5eab41ddb93d9c49d4bc1756), [`c71dc46`](https://github.com/nozzle/mosaic-adapters/commit/c71dc463512416c18ad9b70eda1da1959e27cf74), [`7ad8964`](https://github.com/nozzle/mosaic-adapters/commit/7ad89646d7f771b11c3e9d0e0e00d6581e50b32e), [`4810a46`](https://github.com/nozzle/mosaic-adapters/commit/4810a46e410c6885b63d53395a1c3990e642b115), [`4ad2f5d`](https://github.com/nozzle/mosaic-adapters/commit/4ad2f5df1674bf1709523ce46dc957519ef23714), [`ec34218`](https://github.com/nozzle/mosaic-adapters/commit/ec34218a96fb713777979df61225a61586d00b9c), [`27fe544`](https://github.com/nozzle/mosaic-adapters/commit/27fe544138b29c4a7323eddc3f2b0410fe02ae3f), [`9799aaa`](https://github.com/nozzle/mosaic-adapters/commit/9799aaa3e3df1557e6256acb7fcebae76a2d5f2a), [`4df81ea`](https://github.com/nozzle/mosaic-adapters/commit/4df81eaef7b43cd10b9d55671836f401d38c4a0a), [`6608afc`](https://github.com/nozzle/mosaic-adapters/commit/6608afc216a75604ab15cfd341a860f395e9ca87), [`974f5d7`](https://github.com/nozzle/mosaic-adapters/commit/974f5d79baed078d5afbfb0f5573f5c3bee6f8d6), [`e1277e1`](https://github.com/nozzle/mosaic-adapters/commit/e1277e1ec168fb5ea0bb7059efe6ec255725b9de), [`95ba3e1`](https://github.com/nozzle/mosaic-adapters/commit/95ba3e1ae10725051e5a34fe681ed46217d04529), [`9c5a5ee`](https://github.com/nozzle/mosaic-adapters/commit/9c5a5eea7fce13b4e0f125e93645deea24283e72), [`9c5a5ee`](https://github.com/nozzle/mosaic-adapters/commit/9c5a5eea7fce13b4e0f125e93645deea24283e72), [`5f066c8`](https://github.com/nozzle/mosaic-adapters/commit/5f066c8eddc855d1ffec27cd427f8e58237545f1), [`15f1cd3`](https://github.com/nozzle/mosaic-adapters/commit/15f1cd3e0a3f632c66cce24e903882f32d950586), [`5067e8a`](https://github.com/nozzle/mosaic-adapters/commit/5067e8af5a9b82698a90bfd6a2938fd2370e1138)]:
  - @nozzleio/mosaic-core@0.10.0

## 0.11.1

### Patch Changes

- Updated dependencies [[`0fb10fc`](https://github.com/nozzle/mosaic-adapters/commit/0fb10fcc1f26795763b9e00fea97943ed69c66e9)]:
  - @nozzleio/mosaic-core@0.9.1

## 0.11.0

### Minor Changes

- [#241](https://github.com/nozzle/mosaic-adapters/pull/241) [`6bdf67f`](https://github.com/nozzle/mosaic-adapters/commit/6bdf67fd6ce2de5f527802c62d60c00a40221532) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.32.0 <1`** (and `@uwdata/vgplot` `>=0.32.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.32` depends on `@uwdata/mosaic-sql@^0.32`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

  No adapter APIs change. Adapting to Mosaic 0.32:

  - Clearing a multi-select facet (`select: 'multi'`) or a rows client's row selection/hover (`selectRows([])`, `setSelectedValues([])`, `hoverRow(null)`, destroy-time cleanup) still **removes** the published clause. Mosaic 0.32's `clausePoints` turns an empty value list into an active `FALSE` predicate (uwdata/mosaic#1256), which would otherwise have filtered every consumer down to zero rows; these paths now publish a clear clause instead.
  - Mosaic 0.32 drops JSON query transport and moves Arrow IPC decoding from connectors into the coordinator's `QueryManager` (set IPC extraction options with `new Coordinator(connector, { ipc })`). Custom `Connector` implementations must return raw Arrow IPC bytes for `arrow` queries; the built-in `wasmConnector`/`socketConnector`/`restConnector` already do.
  - The `QueryManager` now shares one in-flight connector request between concurrent requests for identical SQL (uwdata/mosaic#1171), so a `refetch()` that rebuilds the same SQL as a pending query joins it rather than issuing a second round trip. The current-request guarantee is unaffected: the store settles once, on the current request.
  - Date literals in generated SQL are now zero-padded (`DATE '2024-01-01'`).

  The adapters' own current-request guarantee and the `skipSources` projection in front of the coordinator remain in place: upstream `Coordinator.updateClient` still delivers completions without request identity, and `updateSelection` still re-queries on every `'value'` event without comparing predicates.

### Patch Changes

- [#247](https://github.com/nozzle/mosaic-adapters/pull/247) [`d409cdb`](https://github.com/nozzle/mosaic-adapters/commit/d409cdb3cf4d2b300fd9d6fb22a6cf5a22ff7191) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Reformat the source with oxfmt. There are no runtime or API changes. The published `package.json` lists its fields in a new order.

- [#247](https://github.com/nozzle/mosaic-adapters/pull/247) [`1b4b4b0`](https://github.com/nozzle/mosaic-adapters/commit/1b4b4b0c5faa86edc012c1b821170a42f55abe83) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rename the source's ESLint disable comments to oxlint directives. There are no runtime or API changes.

- [#245](https://github.com/nozzle/mosaic-adapters/pull/245) [`ee4eae3`](https://github.com/nozzle/mosaic-adapters/commit/ee4eae3e790105c53791a3430374be1b7bf4297b) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Build the published packages with tsdown instead of Vite library mode, with type declarations emitted by TypeScript 7. There are no runtime or API changes. The `dist/esm` layout, entry points, and `exports` map are unchanged.

  - Declaration files that no public type refers to are no longer emitted (`base-client.d.ts` and `topology/wiring.d.ts` in `@nozzleio/mosaic-core`, `use-data-client.d.ts` in `@nozzleio/react-mosaic`).
  - The emitted JavaScript and declarations are formatted differently (for example `const` instead of `var` for module-level bindings).

- Updated dependencies [[`6bdf67f`](https://github.com/nozzle/mosaic-adapters/commit/6bdf67fd6ce2de5f527802c62d60c00a40221532), [`71e7827`](https://github.com/nozzle/mosaic-adapters/commit/71e7827dcd633368dd600858f5e5cdaace811e6f), [`5a75b38`](https://github.com/nozzle/mosaic-adapters/commit/5a75b38fd4c82231e6a3e168ac0827a2b3d35542), [`21f2afd`](https://github.com/nozzle/mosaic-adapters/commit/21f2afd3e5893746032bf224e491edaea26502b9), [`ee4eae3`](https://github.com/nozzle/mosaic-adapters/commit/ee4eae3e790105c53791a3430374be1b7bf4297b)]:
  - @nozzleio/mosaic-core@0.9.0

## 0.10.2

### Patch Changes

- Updated dependencies [[`0a64cd3`](https://github.com/nozzle/mosaic-adapters/commit/0a64cd3835feb784ef27cdfb6d84d5295b05841c)]:
  - @nozzleio/mosaic-core@0.8.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`587ab10`](https://github.com/nozzle/mosaic-adapters/commit/587ab10157ac742a44d43451f77fa3ae5bad7c2f), [`b0443b5`](https://github.com/nozzle/mosaic-adapters/commit/b0443b5fdd6fb236a812f5ce3a831386f622abd6)]:
  - @nozzleio/mosaic-core@0.8.1

## 0.10.0

### Minor Changes

- [#222](https://github.com/nozzle/mosaic-adapters/pull/222) [`b92222b`](https://github.com/nozzle/mosaic-adapters/commit/b92222b6161ccd53097e2b6cb01096eed275bc9f) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.31.0 <1`** (and `@uwdata/vgplot` `>=0.31.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.31` depends on `@uwdata/mosaic-sql@^0.31`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

  No adapter APIs change. Mosaic 0.31 is adopted for its upstream hardening, which the adapters inherit as-is:

  - Pre-aggregated materialized-view **creation** failures are now caught, logged through the coordinator's logger, and degrade to the standard query path (uwdata/mosaic#1158) — previously only a failing pre-aggregated **update** fell back. A wrong-but-valid pre-aggregated query still returns incorrect rows silently, so the `filterStable: false` guidance for grouped clients is unchanged.
  - Window-expression detection in `@uwdata/mosaic-sql` is now whitespace/case tolerant (uwdata/mosaic#1145), and additional DuckDB aggregate names (`countif`, `list`, `sem`, `geometric_mean`, `arg_max_null`, …) are recognized (uwdata/mosaic#1143), so verbatim aggregate/window expressions in query factories are classified correctly in more cases.

### Patch Changes

- Updated dependencies [[`b92222b`](https://github.com/nozzle/mosaic-adapters/commit/b92222b6161ccd53097e2b6cb01096eed275bc9f)]:
  - @nozzleio/mosaic-core@0.8.0

## 0.9.0

### Minor Changes

- [#217](https://github.com/nozzle/mosaic-adapters/pull/217) [`b96e9af`](https://github.com/nozzle/mosaic-adapters/commit/b96e9afbdc3c801ad1f4bb50192351bb1b21c9f1) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.30.0 <1`.** Upgrade both Mosaic packages to 0.30 or newer when installing any of the four adapter packages. The two floors move together because `@uwdata/mosaic-core@0.30` itself depends on `@uwdata/mosaic-sql@^0.30`: pairing it with an older SQL release would leave two copies of the SQL AST in the tree, and Mosaic's pre-aggregator matches clause `fields` to predicate nodes by class identity.

  Main data-client query failures now retain Mosaic 0.30's `QueryError` in `store.state.error`. The public state type stays `Error | null`, while consumers can narrow with `instanceof QueryError` from `@uwdata/mosaic-core` to inspect the coordinator-issued SQL via `.sql` and the underlying failure via `.cause`. Schema field-info failures remain plain errors because that path queries the coordinator directly.

  Separate rows-count failures (`rowCount: 'query'`) are reported through the coordinator's logger and retried on a later build, leaving the successful main query's `status`/`error` untouched — a failed side-channel count must not wedge rows that loaded fine.

  Mosaic 0.30 also retries the standard (non pre-aggregated) query when a pre-aggregated selection update returns a `QueryError`, so a client that wrongly claims `filterStable` and produces a failing optimizer path degrades to a correct, slower query instead of getting stuck. A wrong-but-valid pre-aggregated query still returns incorrect rows with no error, so the `filterStable: false` guidance for grouped clients is unchanged.

- [#219](https://github.com/nozzle/mosaic-adapters/pull/219) [`5efd1eb`](https://github.com/nozzle/mosaic-adapters/commit/5efd1eb758f200224ec23fc801918d5b00c327d5) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING:** `useVgPlot` and the `VgPlotElement` type have moved off the package root onto a new `@nozzleio/react-mosaic/vgplot` entry point. Everything else on the root export is unchanged.

  `@uwdata/vgplot` is now declared as an optional peer dependency (`>=0.30.0 <1`), so it is only required by consumers that import the new subpath.

  Migration — update the import path:

  ```diff
  -import { useVgPlot } from '@nozzleio/react-mosaic';
  -import type { VgPlotElement } from '@nozzleio/react-mosaic';
  +import { useVgPlot } from '@nozzleio/react-mosaic/vgplot';
  +import type { VgPlotElement } from '@nozzleio/react-mosaic/vgplot';
  ```

  The hook's signature and behaviour (including the `deps` rebuild semantics) are unchanged.

### Patch Changes

- Updated dependencies [[`b96e9af`](https://github.com/nozzle/mosaic-adapters/commit/b96e9afbdc3c801ad1f4bb50192351bb1b21c9f1)]:
  - @nozzleio/mosaic-core@0.7.0

## 0.8.0

### Minor Changes

- [#212](https://github.com/nozzle/mosaic-adapters/pull/212) [`0173af6`](https://github.com/nozzle/mosaic-adapters/commit/0173af61fe937077811eec09be6261ba2b88c886) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add `useMosaicParamRef` and `useMosaicParamValue` for working with topology Params from React. `useMosaicParamRef(ref)` resolves a declared or external Param through the nearest `MosaicTopologyProvider`, mirroring `useMosaicSelectionRef`. `useMosaicParamValue(param)` reactively reads a Param's current value, re-rendering on every `value` change and re-subscribing when a different Param instance is passed. `useTopology` now also keys topology recreation on the identities of `options.params` and `options.paramOptions`, matching the existing `options.selections` / `options.filterSets` semantics. `useMosaicParamRef` is generic — `useMosaicParamRef<TParamValue = any>(ref)` — so a caller can write `useMosaicParamRef<MedalMetric>('metric')` and get a typed `Param` without a cast.

### Patch Changes

- Updated dependencies [[`1a5d3ab`](https://github.com/nozzle/mosaic-adapters/commit/1a5d3ab714c19bbebacc68c8c8f81ef0b1e792ed), [`1a5d3ab`](https://github.com/nozzle/mosaic-adapters/commit/1a5d3ab714c19bbebacc68c8c8f81ef0b1e792ed)]:
  - @nozzleio/mosaic-core@0.6.0

## 0.7.0

### Minor Changes

- [#210](https://github.com/nozzle/mosaic-adapters/pull/210) [`2abc8ae`](https://github.com/nozzle/mosaic-adapters/commit/2abc8ae20c58fbe11e94b5dfbaa1c3fbcd809e07) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.29.0`. Mosaic 0.29 adds a required `fields` property to the `SelectionClause` interface — the input field expressions a clause filters over — which the PreAggregator matches to predicate nodes by object identity. Every Selection clause this package constructs (value, subquery, clear, facet, and FilterSet emissions) now populates `fields`, sharing the exact column node instances referenced in each predicate so pre-aggregation keeps working. Clear clauses use the canonical empty form (`clauseNone`/`fields: []`). This is a breaking change for the peer-dependency range; consumers must upgrade their Mosaic packages to `>=0.29.0`.

  `@nozzleio/mosaic-core` also gains a new export, `buildSubqueryClauseParts`, which returns both the `column [NOT] IN (SELECT ...)` predicate and the outer column node so consumers can populate a clause's `fields` with the identical node instance.

### Patch Changes

- Updated dependencies [[`2abc8ae`](https://github.com/nozzle/mosaic-adapters/commit/2abc8ae20c58fbe11e94b5dfbaa1c3fbcd809e07)]:
  - @nozzleio/mosaic-core@0.5.0

## 0.6.0

### Minor Changes

- [#207](https://github.com/nozzle/mosaic-adapters/pull/207) [`a07e42e`](https://github.com/nozzle/mosaic-adapters/commit/a07e42e40b8b55f79f6106c219bda96d9fe0b553) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - The data hooks (`useMosaicRows`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicValues`) now pass through the new `skipSources` option and fold it into their structural identity via `skipSourcesKey`, so changing the excluded-source set rebinds the client while an equal set does not trigger a rebind. `skipSourcesKey` is exported from `use-data-client` alongside `paramsKey`.

### Patch Changes

- Updated dependencies [[`72d551d`](https://github.com/nozzle/mosaic-adapters/commit/72d551dce5b0c47f5f7625595521918a69c70581)]:
  - @nozzleio/mosaic-core@0.4.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`870c794`](https://github.com/nozzle/mosaic-adapters/commit/870c794ad58c1a62f8472dced2ee265c26c27525), [`74ef2a7`](https://github.com/nozzle/mosaic-adapters/commit/74ef2a73d3349430a224c30cee9d06586301542f), [`07aae12`](https://github.com/nozzle/mosaic-adapters/commit/07aae12f262b044e6d30ddc04f7e9ba7a7093f3c), [`b7d6a27`](https://github.com/nozzle/mosaic-adapters/commit/b7d6a273092525fb83d2a9fde5b1a96062c4d66c), [`c6cc739`](https://github.com/nozzle/mosaic-adapters/commit/c6cc7397c36f8e4e360d1ec5bdbe60f515b812c2)]:
  - @nozzleio/mosaic-core@0.3.1

## 0.5.0

### Minor Changes

- [#202](https://github.com/nozzle/mosaic-adapters/pull/202) [`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Histogram clients now accept `scale: 'linear' | 'log'`. Log-scaled histograms
  discover a positive extent and produce multiplicative bin boundaries, allowing
  custom renderers to align queried counts with a logarithmic visual axis.

- [#199](https://github.com/nozzle/mosaic-adapters/pull/199) [`c07ceee`](https://github.com/nozzle/mosaic-adapters/commit/c07ceee82c1081dc488a47cf6baa65feef267fd8) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `useTopology` now takes an optional construction initializer on its options bag as `UseTopologyOptions.initialize`, alongside the existing `selections` / `filterSets` fields, letting applications synchronously seed a newly-created topology before querying children receive it. If initialization throws, the partially-built topology is destroyed before the error propagates.

  Recreation is now keyed on the identities of `config`, `options.selections`, and `options.filterSets` individually — no longer on the options bag object as a whole — so callers may build the bag inline each render (`useTopology(config, { ...options, initialize })`) without rebuilding the topology. `initialize`'s identity never keys recreation.

### Patch Changes

- Updated dependencies [[`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4)]:
  - @nozzleio/mosaic-core@0.3.0

## 0.4.1

### Patch Changes

- [#194](https://github.com/nozzle/mosaic-adapters/pull/194) [`e590fed`](https://github.com/nozzle/mosaic-adapters/commit/e590fedc9bca9d936fcb14d694ae7bae6ec12d63) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Use `useSelector` instead of the deprecated `useStore` from `@tanstack/react-store` for all store subscriptions. No change to hook behavior or public APIs.

- Updated dependencies [[`33367fb`](https://github.com/nozzle/mosaic-adapters/commit/33367fba7ed50e915612e67570d83d19bf386207)]:
  - @nozzleio/mosaic-core@0.2.1

## 0.4.0

### Minor Changes

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — rebuilt from scratch.** `@nozzleio/react-mosaic` is now a set of controlled-binding React hooks over `@nozzleio/mosaic-core`; the legacy provider, registry, and hook APIs are removed. The core is a regular dependency whose full public API is re-exported here (the `@tanstack/react-table` distribution model), so consumers install and import from this package alone.

  - Provider and coordinator: `MosaicProvider`, `useMosaicCoordinator`.
  - Data hooks over the core clients: `useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicSchema`, plus `useVgPlot`.
  - Filter-builder bindings: `useMosaicFilters`, `useFilterBinding`, `useFilterFacet`, and `useFilterChips`.
  - Topology and selection helpers: `useMosaicSelections`, `useCascadingContexts`, `useComposedSelection`, `useMosaicSelectionValue`.

  See `docs/react/*`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds `useFilterSetState` and `useFilterSetChips`, subscription hooks over a `FilterSet`'s `@tanstack/store` (whole state, and just the derived chip list). Additive — no breaking changes.

  - The facet, histogram, and rows client hooks' structural keys now understand the `publish.into` form: a change of target `FilterSet`, spec `id`, `kind`, or `label` recreates the client, matching the existing `publish.as` identity rules.

  See `docs/core/filter-set.md` and `docs/react/hooks.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — filter-builder hooks deleted.** The per-binding hook surface is subsumed by the `FilterSet` hooks.

  - Removed: `useFilterBinding`, `useMosaicFilters`, `useFilterFacet`, `useFilterBindingControllerState`, `useFilterChips`, and the `FilterBindingPersister` types.
  - Migrate to `useFilterSetState` / `useFilterSetChips` over a `createFilterSet`, and `publish.into` on the facet, histogram, and rows client hooks for widget-to-set wiring.

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **Contains breaking changes (0.x convention).** `persist` passes through `useMosaicFacet`, `useMosaicHistogram`, and `useMosaicRows` as a structural option — a new persister identity is a new storage location, so keep it stable (module scope or `useMemo`) or the client recreates every render.

  - Breaking: scope-level filter persistence is removed — `FilterScopePersister`, `FilterScopePersistenceContext`, `FilterScopePersistenceWriteContext`, `createFilterScopePersistenceContext`, `createSparseFilterScopeSnapshot`, and the `persister` option on `useMosaicFilters` are gone. Per-binding persisters (`useFilterBinding({ persister })`) cover the use case.
  - Breaking: `FilterBindingPersister` is re-typed as `Persister<FilterBindingState, FilterBindingPersistenceContext>` (the new core contract). The write reason `'apply'` is renamed to `'update'`; `FilterPersistenceWriteReason` is now an alias of the core's `PersisterWriteReason`.

  See `docs/core/filter-builder.md` and `docs/react/hooks.md`.

- [#185](https://github.com/nozzle/mosaic-adapters/pull/185) [`e46da90`](https://github.com/nozzle/mosaic-adapters/commit/e46da901a1386566ffc9bbd92a765b7b667086c5) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add `useMosaicSelection(type = 'intersect')` — a singular companion to `useMosaicSelections` returning one stable `Selection`. It's the first hook most consumers reach for, both for `filterBy` / `havingBy` wiring and as a lightweight pub/sub channel between sibling widgets. The `useState(() => Selection.single())` idiom is documented as the escape hatch.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- Updated dependencies [[`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58), [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7), [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761), [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd), [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7), [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4)]:
  - @nozzleio/mosaic-core@0.2.0

## 0.3.2

### Patch Changes

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`2c00d03`](https://github.com/nozzle/mosaic-adapters/commit/2c00d036c0df450b1a558c14ce9c438c8131c4e0) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic packages to `^0.27.0`

## 0.3.1

### Patch Changes

- [#132](https://github.com/nozzle/mosaic-adapters/pull/132) [`5439926`](https://github.com/nozzle/mosaic-adapters/commit/54399261350487a9d49a4e388a2eed7ae68f4b1d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: trigger fresh CI release

## 0.3.0

### Minor Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`83b321e`](https://github.com/nozzle/mosaic-adapters/commit/83b321e9a6797592441b182d55a602b6f8f0b38d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table,react-mosaic): require 0.24.3 peer APIs

### Patch Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`9e9e945`](https://github.com/nozzle/mosaic-adapters/commit/9e9e945a59cb540dd308833d3cce0b280f316389) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic to `0.24.3`

## 0.2.0

### Minor Changes

- [#115](https://github.com/nozzle/mosaic-adapters/pull/115) [`53d8c34`](https://github.com/nozzle/mosaic-adapters/commit/53d8c3410d6224cfb9b6a5553cf12380f9353b18) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(react-mosaic): add source-scoped selection value reads

### Patch Changes

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`d79ebb3`](https://github.com/nozzle/mosaic-adapters/commit/d79ebb3a62ec877e4fe40a92eebb948112a31e3e) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(react-mosaic): make mosaic-core a peer dependency

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`11f58c4`](https://github.com/nozzle/mosaic-adapters/commit/11f58c44eda51e0824d2b94683cec6d21ac2e30c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(deps): upgrade @uwdata/mosaic packages to 0.24.2

## 0.1.1

### Patch Changes

- [#107](https://github.com/nozzle/mosaic-adapters/pull/107) [`87ab23c`](https://github.com/nozzle/mosaic-adapters/commit/87ab23c4f68caf15445fc2d8a3d78de888c14dbc) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Refresh the published packages against the latest compatible `@uwdata` Mosaic releases. This updates the workspace to `@uwdata/mosaic-core` `0.23.1` and `@uwdata/mosaic-sql` `0.23.0` for the adapter packages.

## 0.1.0

### Minor Changes

- [#103](https://github.com/nozzle/mosaic-adapters/pull/103) [`82ca7ff`](https://github.com/nozzle/mosaic-adapters/commit/82ca7ff9c0c558ee7e0b80b5b59eff6f8f5238ef) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add schema-driven filter-builder primitives for page and widget filter scopes.

  `@nozzleio/mosaic-tanstack-react-table`
  - add `FilterDefinition`-based filter-builder types
  - add `useMosaicFilters` for creating page and widget filter scopes
  - add `useFilterBinding` for operator/value binding
  - add `useFilterFacet` for facet-backed filter options
  - add docs and a trimmed example showing dynamic filter scope composition

  `@nozzleio/react-mosaic`
  - add `useComposedSelection` for explicit selection composition in React

  `@nozzleio/mosaic-tanstack-table-core`
  - add reusable condition predicate construction for filter-builder-backed condition filters

## 0.0.3

### Patch Changes

- [#101](https://github.com/nozzle/mosaic-adapters/pull/101) [`0ca8136`](https://github.com/nozzle/mosaic-adapters/commit/0ca8136ac285d3fb845d7edc7f211945debf3891) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Trigger a patch release across the published packages.

## 0.0.2

### Patch Changes

- [#94](https://github.com/nozzle/mosaic-adapters/pull/94) [`46d0702`](https://github.com/nozzle/mosaic-adapters/commit/46d07023be41c7a297b5af72a2080fd3defe7d84) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Publish the first automated patch release through the Changesets and trusted publishing workflow.

This file is maintained by Changesets.
