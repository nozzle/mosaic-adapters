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
 *
 * Not every parent publishes through `update()`: a snapshot-style Selection
 * (upstream `clone()`/`remove()`, or an application projection that installs
 * a complete mapped clause list and emits `'value'` itself) never touches the
 * relay. The derived therefore also follows the parent's emitted `'value'`,
 * re-deriving the effective list from `parent.clauses` and emitting once only
 * when it differs in content — same sources, predicate SQL and `clients` —
 * so a parent that mints fresh clause objects per snapshot does not re-query
 * consumers whose effective inputs are unchanged. Both paths are idempotent
 * with each other: after a relayed `update()` the re-derivation finds the
 * same clause objects and does nothing.
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

/** Stable identity of a clause's source: its string `id` when it has one, else the object. */
function sourceKey(clause: SelectionClause): unknown {
  const source = clause.source as { id?: unknown } | null | undefined;
  if (
    typeof source === 'object' &&
    source !== null &&
    typeof source.id === 'string'
  ) {
    return source.id;
  }
  return clause.source;
}

function sameClients(
  a: ReadonlySet<unknown> | undefined,
  b: ReadonlySet<unknown> | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.size !== b.size) {
    return false;
  }
  for (const client of a) {
    if (!b.has(client)) {
      return false;
    }
  }
  return true;
}

/**
 * Content equality for a clause: same source, same predicate SQL, same
 * `clients` set. `clients` participates because a re-keyed clause with
 * identical SQL changes this client's crossfilter self-exclusion, which must
 * still re-query (the same reason `FilterSet` bypasses its SQL memo then).
 */
function sameClause(a: SelectionClause, b: SelectionClause): boolean {
  if (a === b) {
    return true;
  }
  if (sourceKey(a) !== sourceKey(b)) {
    return false;
  }
  if (String(a.predicate) !== String(b.predicate)) {
    return false;
  }
  return sameClients(a.clients, b.clients);
}

function sameClauseList(
  a: ReadonlyArray<SelectionClause>,
  b: ReadonlyArray<SelectionClause>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!sameClause(a[index]!, b[index]!)) {
      return false;
    }
  }
  return true;
}

class SkipProjectedSelection extends Selection {
  readonly #skip: ReadonlySet<string>;
  readonly #parent: Selection;

  constructor(parent: Selection, skip: ReadonlySet<string>) {
    super(parent.resolver);
    this.#skip = skip;
    this.#parent = parent;
    // Seed synchronously from the parent's resolved state (not `.clauses`,
    // which lags one dispatch) the same way upstream `clone()` does, so the
    // first query sees the effective clause list without emitting events.
    const seeded = this.#effective(parent._resolved);
    this._value = seeded;
    this._resolved = seeded;
  }

  #effective(clauses: Selection['clauses']): Selection['clauses'] {
    const effective: Selection['clauses'] = clauses.filter(
      (clause) => !isSkippedClause(clause, this.#skip),
    );
    const active = clauses.active;
    if (active !== undefined && !isSkippedClause(active, this.#skip)) {
      effective.active = active;
    }
    return effective;
  }

  /**
   * Follow a parent that emitted `'value'` without relaying through
   * `update()`. Emits directly rather than via `Param.update`, whose
   * not-distinct branch would cancel any queued newer value.
   */
  readonly followParent = (): void => {
    const effective = this.#effective(this.#parent.clauses);
    // Only the kept list decides: a parent whose active clause is skipped (or
    // foreign to the kept list) changed nothing this consumer can observe.
    if (sameClauseList(this._resolved, effective)) {
      return;
    }
    this._resolved = effective;
    void this.emit('value', effective);
  };

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
  parent.addEventListener('value', selection.followParent);
  let destroyed = false;
  return {
    selection,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detachIncludedSelection(parent, selection);
      parent.removeEventListener('value', selection.followParent);
    },
  };
}
