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
  Selection,
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
 * A clause spec for subquery-bearing predicates. Identical to
 * {@link ValueClauseSpec} except that `meta` is structurally forbidden:
 * Mosaic's PreAggregator assumes `point`/`interval` predicates have simple
 * value-test shapes, and a subquery predicate tagged that way produces
 * incorrect optimized queries. Without `meta`, Mosaic safely uses the
 * standard query path.
 */
export type SubqueryClauseSpec = Omit<ValueClauseSpec, 'meta'>;

/**
 * Builds a Selection clause whose predicate embeds a scalar subquery
 * (e.g. `col IN (SELECT ...)`). Never attaches optimizer `meta`.
 */
export function createSubqueryClause(
  spec: SubqueryClauseSpec,
): SelectionClause {
  return {
    source: spec.source,
    clients: spec.clients,
    value: spec.value,
    predicate: spec.predicate,
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

/**
 * `selection.update(clause)` with change suppression: the update is skipped
 * when the source's existing clause already carries an equal predicate
 * (compared by generated SQL), or when the clause clears a source that has
 * no active clause. Every suppressed update avoids a Selection value event —
 * and with it a re-query of every consumer.
 *
 * This is the convergence guard for rebuild-on-context-change publishers
 * (e.g. membership subqueries embedding sibling filter context): the rebuild
 * republishes only when the predicate actually changed, so a converged state
 * publishes nothing. Note the comparison is predicate-only — a clause whose
 * `value` changed but whose predicate is unchanged is also suppressed.
 *
 * The comparison reads the Selection's resolved clause list (`_resolved`),
 * which upstream maintains synchronously across unemitted value events —
 * `selection.clauses` reads the last *emitted* state, which is one tick
 * stale once listeners are attached and would defeat the suppression.
 *
 * @returns true when the update was applied, false when suppressed.
 */
export function updateClauseIfChanged(
  selection: Selection,
  clause: SelectionClause,
): boolean {
  const current = selection._resolved.find(
    (existing) => existing.source === clause.source,
  );

  if (current === undefined && clause.predicate == null) {
    return false;
  }
  if (
    current?.predicate != null &&
    clause.predicate != null &&
    String(current.predicate) === String(clause.predicate)
  ) {
    return false;
  }

  selection.update(clause);
  return true;
}
