---
'@nozzleio/mosaic-core': minor
---

`createTopology` now models Mosaic `Param` nodes as first-class topology entries. A `param` declaration owns a `Param.value(default)`, while an `external-param` declaration binds a caller-supplied instance passed via `options.params` (with the same strict symmetry checks as `external` selections). Params resolve through the new `resolveParam(ref)` accessor and are exposed eagerly on the `params` record; they are validated as leaves and rejected in compose `include`, cascading `keys`/`externals`, and filter-set `context` refs. `reset()` restores owned params to their `default` (honoring `reset: false`), skips external params, and params are never enumerated as active clauses. `resolveParam` is generic — `resolveParam<TParamValue = any>(ref)` — so a caller can assert the value type at the call site (`resolveParam<MedalMetric>('metric')`) instead of casting the result.
