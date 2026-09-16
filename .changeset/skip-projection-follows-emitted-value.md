---
'@nozzleio/mosaic-core': patch
---

The `skipSources` projection now also follows a parent Selection that publishes snapshots without `update()` — one that installs a complete clause list and emits `'value'` itself, as upstream `clone()`/`remove()` and application-side source projections do. Previously such a parent never reached the relay, so a skipping client stopped re-querying on kept clause changes after 0.8.1. The projection re-derives the effective list from the emitted value and emits once only when it differs in content (source, predicate SQL, `clients`), so a parent minting fresh clause objects per snapshot still issues no redundant query.
