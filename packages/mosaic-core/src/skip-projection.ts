/**
 * {@link createSkipProjectedSelection}: the Selection a data client with
 * `skipSources` actually subscribes to.
 *
 * Upstream `Coordinator.updateSelection` re-queries every connected client on
 * every `'value'` event of the Selection it was connected with; it never
 * compares the resulting predicate against the previous one. Stripping skipped
 * clauses only while building SQL (the pre-#229 approach) therefore still
 * issued a byte-identical query, and flipped the store to `'pending'`, each
 * time a skipped-only clause changed.
 *
 * The projection moves the skip in front of the coordinator: it is a
 * {@link createMappedSelection} whose map drops every clause with a
 * `source.id` in the skip set and passes every other clause through by
 * reference. Skipped sources never reach the derived Selection, so the
 * coordinator never hears about them; kept clauses keep their `clients` sets —
 * and with them crossfilter self-exclusion and the active-clause short-circuit
 * — exactly as on the parent. The derived shares the parent's resolver, so
 * `union`/`intersect`/`single`/`empty`/`cross` semantics are the parent's,
 * evaluated over the effective clause list. Snapshot-style parents (no
 * `update()` relay) are followed by content, as described on
 * {@link createMappedSelection}.
 */
import type { Selection, SelectionClause } from '@uwdata/mosaic-core';

import { createMappedSelection } from './mapped-selection';

/** Handle returned by {@link createSkipProjectedSelection}. */
export interface SkipProjectedSelectionHandle {
  /** The derived Selection carrying only non-skipped clauses. */
  readonly selection: Selection;
  /** Detach from the parent relay. Idempotent. */
  destroy: () => void;
}

/** True when the clause's source carries a string `id` in `skip`. */
export function isSkippedClause(clause: SelectionClause, skip: ReadonlySet<string>): boolean {
  const source = clause.source as { id?: unknown } | null | undefined;
  if (typeof source !== 'object' || source === null) {
    return false;
  }
  return typeof source.id === 'string' && skip.has(source.id);
}

/**
 * Derive a Selection from `parent` that ignores every clause whose
 * `source.id` is in `skip`. Callers pass the derived Selection to the
 * coordinator (as `makeClient`'s `selection`) so skipped-only changes produce
 * no re-query; they must call `destroy()` when the consumer goes away so the
 * parent stops relaying into it.
 */
export function createSkipProjectedSelection(
  parent: Selection,
  skip: ReadonlySet<string>,
): SkipProjectedSelectionHandle {
  const mapped = createMappedSelection(parent, (clause) => {
    if (isSkippedClause(clause, skip)) {
      return null;
    }
    return clause;
  });
  return { selection: mapped.selection, destroy: mapped.destroy };
}
