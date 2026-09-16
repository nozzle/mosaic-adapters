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
 * The projection moves the skip in front of the coordinator: a derived
 * Selection registered in the parent's relay set (exactly how upstream
 * `include` and this package's `createComposedSelection` work) that drops
 * relayed operations whose clause `source.id` is in the skip set. Skipped
 * sources never reach the derived Selection, so the coordinator never hears
 * about them; kept clauses are relayed by reference, so their `clients` sets —
 * and with them crossfilter self-exclusion and the active-clause short-circuit
 * — behave exactly as on the parent. The derived shares the parent's resolver,
 * so `union`/`intersect`/`single`/`empty`/`cross` semantics are the parent's,
 * evaluated over the effective clause list.
 */
import { Selection } from '@uwdata/mosaic-core';
import {
  attachIncludedSelection,
  detachIncludedSelection,
} from './topology/wiring';
import type { SelectionClause } from '@uwdata/mosaic-core';

/** Handle returned by {@link createSkipProjectedSelection}. */
export interface SkipProjectedSelectionHandle {
  /** The derived Selection carrying only non-skipped clauses. */
  readonly selection: Selection;
  /** Detach from the parent relay. Idempotent. */
  destroy: () => void;
}

/** True when the clause's source carries a string `id` in `skip`. */
export function isSkippedClause(
  clause: SelectionClause,
  skip: ReadonlySet<string>,
): boolean {
  const source = clause.source as { id?: unknown } | null | undefined;
  if (typeof source !== 'object' || source === null) {
    return false;
  }
  return typeof source.id === 'string' && skip.has(source.id);
}

class SkipProjectedSelection extends Selection {
  readonly #skip: ReadonlySet<string>;

  constructor(parent: Selection, skip: ReadonlySet<string>) {
    super(parent.resolver);
    this.#skip = skip;
    // Seed synchronously from the parent's resolved state (not `.clauses`,
    // which lags one dispatch) the same way upstream `clone()` does, so the
    // first query sees the effective clause list without emitting events.
    const seeded = parent._resolved.filter(
      (clause) => !isSkippedClause(clause, skip),
    );
    this._value = seeded;
    this._resolved = seeded;
  }

  override update(clause: SelectionClause): this {
    if (isSkippedClause(clause, this.#skip)) {
      return this;
    }
    return super.update(clause);
  }

  override activate(clause: SelectionClause): void {
    if (isSkippedClause(clause, this.#skip)) {
      return;
    }
    super.activate(clause);
  }

  override reset(clauses?: Array<SelectionClause>): this {
    if (clauses === undefined) {
      return super.reset();
    }
    return super.reset(
      clauses.filter((clause) => !isSkippedClause(clause, this.#skip)),
    );
  }
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
  const selection = new SkipProjectedSelection(parent, skip);
  attachIncludedSelection(parent, selection);
  let destroyed = false;
  return {
    selection,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detachIncludedSelection(parent, selection);
    },
  };
}
