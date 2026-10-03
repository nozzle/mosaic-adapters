---
'@nozzleio/mosaic-core': patch
---

Fix `createMappedSelection` (and `skipSources` projections) on a `single` parent: a clause the map drops, or a removal for a source the derived Selection does not carry, still displaces the parent's other clauses, and the derived Selection now relays that to the Selections that `include` it. Before, the derived Selection itself followed the parent once it emitted, but a Selection including it kept the displaced clause. `filterSet.batch()` / `topology.batch()` apply the same rule inside a batch.
