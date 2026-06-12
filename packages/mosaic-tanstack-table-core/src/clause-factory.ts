/**
 * Central construction point for the Selection clauses this package writes
 * via `selection.update(...)`.
 *
 * Mosaic Selection clauses are predicate-shape agnostic, but the clause
 * `meta` field is not: Mosaic's PreAggregator assumes `meta.type: 'point'`
 * predicates are simple column tests and `interval` predicates are exactly
 * BETWEEN-shaped. Routing all clause construction through this module keeps
 * the `meta` policy in one place:
 *
 * - VALUE clauses (this module today): predicates built from literal values
 *   (comparisons, IN lists, LIKE patterns, list functions). These may carry
 *   optimizer `meta` hints.
 * - SUBQUERY clauses (future): predicates embedding scalar subqueries
 *   (e.g. `col IN (SELECT ...)`). These must NEVER carry `meta`; without it
 *   Mosaic safely falls back to the standard (non pre-aggregated) query path.
 */
import type {
  ClauseMetadata,
  ClauseSource,
  MosaicClient,
  SelectionClause,
} from '@uwdata/mosaic-core';

export interface ValueClauseSpec {
  /** Unique identity for the clause (object equality). One clause per source. */
  source: ClauseSource;
  /** Clients that should NOT be re-queried by this clause (cross-filter semantics). */
  clients?: Set<MosaicClient>;
  /** App-level value associated with the clause; not used for SQL generation. */
  value: unknown;
  /** SQL predicate; `null` removes the source's clause from the Selection. */
  predicate: SelectionClause['predicate'];
  /**
   * Optional optimizer hints. Only valid for predicates built from literal
   * values; never attach `meta` to subquery-bearing predicates.
   */
  meta?: ClauseMetadata;
}

/**
 * Builds a Selection clause whose predicate is derived from literal values.
 */
export function createValueClause(spec: ValueClauseSpec): SelectionClause {
  return {
    source: spec.source,
    clients: spec.clients,
    value: spec.value,
    predicate: spec.predicate,
    meta: spec.meta,
  };
}

/**
 * Builds a clause that removes the source's active clause from a Selection.
 */
export function createClearClause(
  source: ClauseSource,
  clients?: Set<MosaicClient>,
): SelectionClause {
  return {
    source,
    clients,
    value: null,
    predicate: null,
  };
}
