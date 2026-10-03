---
'@nozzleio/mosaic-core': patch
---

Fix topology context seeding when several clauses land on a source Selection in the same tick. `compose` and `cascading` contexts now seed from each source's resolved clause list instead of `.clauses`, which only reflects the last emitted list and could miss clauses (for example when a FilterSet hydrates multiple specs at once). Null-predicate clauses are skipped when seeding.

`topology.reset()` now clears `standalone` and `external` entries with upstream `selection.reset()`: all clauses are removed in a single update, the removal relays to derived contexts, and each clause source's `reset()` is invoked, so interactors such as vgplot interval brushes clear their own value and overlay too.
