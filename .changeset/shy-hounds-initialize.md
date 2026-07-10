---
'@nozzleio/react-mosaic': minor
---

`useTopology` now takes an optional construction initializer on its options bag as `UseTopologyOptions.initialize`, alongside the existing `selections` / `filterSets` fields, letting applications synchronously seed a newly-created topology before querying children receive it. If initialization throws, the partially-built topology is destroyed before the error propagates.

Recreation is now keyed on the identities of `config`, `options.selections`, and `options.filterSets` individually — no longer on the options bag object as a whole — so callers may build the bag inline each render (`useTopology(config, { ...options, initialize })`) without rebuilding the topology. `initialize`'s identity never keys recreation.
