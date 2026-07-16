/**
 * Shared low-level Selection wiring used by the composition factories in this
 * module (and, later, by `createTopology`).
 *
 * Mosaic's `Selection` relays clauses to any derived Selection registered in its
 * internal `_relay` set (see `Selection.include` / the `include` constructor
 * arg). The composition primitives here wire that relay imperatively so a
 * derived "context" Selection mirrors the clauses of one or more source
 * Selections, and — critically — can be torn down again: detaching the relay
 * link AND clearing the clauses that were seeded onto the context, so a
 * destroyed handle leaves no residue on the derived Selection and stops
 * propagating.
 */
import { clauseNone } from '@uwdata/mosaic-core';
import type { Selection } from '@uwdata/mosaic-core';

/** Register `derived` to receive relayed clauses from `source`. */
export function attachIncludedSelection(
  source: Selection,
  derived: Selection,
): void {
  source._relay.add(derived);
}

/** Stop `derived` from receiving relayed clauses from `source`. */
export function detachIncludedSelection(
  source: Selection,
  derived: Selection,
): void {
  source._relay.delete(derived);
}

/**
 * Copy the current clauses of each source Selection onto `context`, so a context
 * wired after its sources already carry clauses reflects that existing state
 * (the relay only forwards *future* updates).
 */
export function seedContext(
  sources: Array<Selection>,
  context: Selection,
): void {
  sources.forEach((selection) => {
    selection.clauses.forEach((clause) => {
      context.update(clause);
    });
  });
}

/**
 * Undo {@link seedContext}: publish a null-predicate clause for every clause the
 * sources currently hold, dropping the seeded clauses from `context` on
 * teardown without touching the source Selections themselves.
 */
export function clearSeededClauses(
  sources: Array<Selection>,
  context: Selection,
): void {
  sources.forEach((selection) => {
    selection.clauses.forEach((clause) => {
      context.update(clauseNone(clause.source));
    });
  });
}
