---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': patch
---

FilterSet gains routing, partial-reset and clause-computation helpers. All additions are opt-in; existing behaviour is unchanged.

- `createFilterSet({ defaultTarget })` picks the target a spec routes to when neither its kind's emission nor the spec names one (resolution order `emission.target ?? spec.target ?? defaultTarget`). It defaults to `'where'`; an explicit value must name one of `targets` or `createFilterSet` throws. `filterSet.defaultTarget` reads back the resolved value, and `filterSet.kinds` exposes the set's merged, frozen kind registry. Topology `filter-set` declarations accept the same `defaultTarget`, validated by `createTopology`.
- `filterSet.reset({ keep })` removes only the specs the predicate rejects, in one store update and one persister write. Kept specs stay published and are not re-published (unless their kind reads `contextPredicate` and the SQL changes). If `keep` accepts every spec, the call is a no-op.
- New `emitFilterSpec(spec, options)` and `filterSpecPredicate(spec, options)` compute the clauses a spec would publish without going through a set. The set's own publish path uses the same code, so the results cannot drift.
- `publish: { into, id, kind?, label?, target? }` on the facet, histogram and rows clients now accepts `target`, written to the published spec's `target`. A remounted widget that re-adopts an existing spec keeps the stored `target`.

New exported types: `EmitFilterSpecOptions`, `FilterSetResetOptions`, `FilterSpecEmission` and `FilterSpecPredicateOptions`.

In `@nozzleio/react-mosaic`, `useMosaicFacet`, `useMosaicHistogram` and `useMosaicRows` recreate their client when `publish.target` changes, matching the other `publish.into` fields.
