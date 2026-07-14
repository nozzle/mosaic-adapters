---
'@nozzleio/mosaic-core': minor
---

Data clients now accept `skipSources?: ReadonlySet<string>` on `DataClientOptions`, a read-side clause filter that ignores named clause sources when resolving `filterBy` (WHERE) and `havingBy` (HAVING), matched against each clause's `source.id`. This lets a consumer opt out of specific filters in a shared `Selection` — Grafana-style per-widget filter scoping — while still honoring the rest.

Resolution delegates to the Selection's own resolver, so union/intersect/`empty`/crossfilter semantics (including this client's own crossfilter self-exclusion) are preserved exactly; a multi-target `FilterSet` spec keys every clause to its spec id, so skipping an id drops all of that spec's clauses. Sources without a string `id` are never skipped. Absent or empty → behavior is identical to before. A non-empty set forces `filterStable: false` so pre-aggregation (which re-applies the active clause outside the client's query callback) cannot leak a skipped clause back in.
