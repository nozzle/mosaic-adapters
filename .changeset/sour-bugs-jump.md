---
'@nozzleio/mosaic-core': patch
---

Sparkline clients without a `filterBy` selection no longer issue a trivial `WHERE FALSE` query when `inputs.keys` is empty — they publish the empty series state directly and skip the database round trip entirely, with `store.state.lastQuery` as `null` for the skipped case. Cross-filtered sparklines keep the trivial `WHERE FALSE` query for empty keys, since upstream selection updates always expect a real query.
