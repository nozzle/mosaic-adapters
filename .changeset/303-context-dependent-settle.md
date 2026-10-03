---
'@nozzleio/mosaic-core': patch
---

Fix a FilterSet with two or more context-dependent specs (kinds that read `contextPredicate`, such as two `aggregateThresholdFilterKind` thresholds) whose clauses feed the set's own context: it now settles instead of rebuilding forever, each spec embedding the other's latest subquery one level deeper.

While a spec's own clauses feed the context, its `contextPredicate` now also leaves out the clauses of the set's other context-dependent specs. Each threshold's inner `GROUP BY … HAVING` is evaluated without the sibling thresholds; the context itself still applies all of them, so a row must still pass every threshold. Nothing changes for a set with zero or one context-dependent spec, or for a context-dependent spec whose clauses do not reach the context.

As a safeguard for context cycles across FilterSets, a set follows a chain of context rebuilds back to itself at most a fixed number of times, then stops and warns once in development. Acyclic chains of sets are never cut off.
