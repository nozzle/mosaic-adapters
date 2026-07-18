---
'@nozzleio/mosaic-core': minor
---

Add per-entry `paramOptions.persist` to `createTopology`, giving topology-owned `param` entries Persister-backed live values. A non-nullish persisted value hydrates the param at construction and wins over the declared `default`; every subsequent value change (including `reset()`'s restore-to-default) writes through the same lifecycle used by filter-set persistence, with hydration echo suppression. Persistence applies to owned `param` entries only — supplying it for any other entry, including an `external-param`, is a construction error.
