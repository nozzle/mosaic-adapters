---
'@nozzleio/mosaic-core': minor
---

Add an opt-in `batch(fn)` to FilterSets and topologies, so several writes from one user action publish as one update. Nothing changes unless you call it.

- `filterSet.batch((tx) => { ... })` defers the Selection emits of every `set` / `remove` / `clear` / `reset` made inside the callback. Resolved clauses update as each write happens; when the callback returns, every touched Selection (targets, and the `compose` / `cascading` contexts and `skipSources` projections derived from them) emits once, `store` updates once and the persister is written once. Context-dependent kinds are rebuilt inside the batch, so they ship with their siblings' final clauses.
- `topology.batch(fn)` shares one batch across every FilterSet the topology owns, plus the Selection resets of `topology.reset()`, and refreshes `activeClauses` once.

Documented limitations:

- A batched emission carries a synthetic active clause (fresh source, `null` predicate), so Mosaic's pre-aggregation is skipped for that one update, `selection.active` is the synthetic clause, and on a crossfilter target the publishing widget re-queries too.
- Only one batch can be open at a time. A nested `batch()` joins the open batch only when that batch already covers it (the same FilterSet, a FilterSet owned by the open topology batch, or the same topology); any other nesting, including `topology.batch()` inside an owned set's `filterSet.batch()` or a `batch()` call from a filter kind or `value` listener while the batch closes, throws `NESTED_BATCH_ERROR_MESSAGE` (now exported).
- Params, direct `selection.update(...)` calls and Selections whose `update` / `reset` are overridden (including `createMappedSelection` results) are not deferred; they emit immediately as usual.
- Not a transaction: if the callback throws, earlier writes still apply and emit, then the callback's error propagates. The callback must be synchronous. A cyclic FilterSet context graph is not guaranteed to settle inside the batch.

New exported types: `FilterSetBatchWriter`.
